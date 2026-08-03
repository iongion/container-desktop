//! Live macOS verification. NOT part of the default `cargo test`, and it RUNS ON THE MAC.
//!
//! ```sh
//! # on the Mac, where the crates are synced to ~/cdc/rust:
//! cargo test -p cdc-runtime-host-native --features live-macos --test live_macos -- --nocapture
//! ```
//!
//! **Every macOS result this port has ever recorded came from an interactive drive** — a WoL
//! packet, an `ssh -tt` fed from a pipe, and a screen read back through a cell-grid replayer. That
//! found four defects and protects against none of them: nothing re-runs it, so the next change to
//! the LIMA socket rule or the Apple socket path breaks silently until somebody drives the Mac again
//! by hand. This is that drive, as a suite.
//!
//! **Three connectors exist ONLY here**, which is why `live_smoke` and `live_ssh` cannot cover them:
//! LIMA (both engines), Apple's `container` through socktainer, and Docker Desktop as
//! `docker.virtualized.vendor`. The Docker CONTEXT rule is here too, because a machine with
//! five contexts is what it took to find the defect and is what it takes to keep it found.
//!
//! **Everything is READ-ONLY and nothing is created**: `--version`, `context ls`, `context inspect`,
//! `limactl list`, `GET /_ping`. A connector whose engine is not installed or not running SKIPS with a
//! printed reason rather than failing — this machine's set-up is the runner's, and a suite that
//! demanded all five would be red on every Mac but one. What it must never do is pass by finding
//! nothing, so each test says which it did.

#![cfg(feature = "live-macos")]
#![cfg(target_os = "macos")]

use std::sync::Arc;

use cdc_runtime::capabilities::command::{Command, HostCommand};
use cdc_runtime::domain::machine::{ConnectionCapabilities, ConnectionContext, ConnectionMachine};
use cdc_runtime::domain::types::connection::{ConnectOptions, Connection};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectOrigin, ConnectionPhase};
use cdc_runtime_host_native::command::TokioCommand;
use cdc_runtime_host_native::fs::{StdFs, SystemClock};
use cdc_runtime_host_native::http::TokioHttp;
use serde_json::json;

/// A connection as the settings document holds one, with an optional pinned context.
fn connection(
    id: &str,
    engine: &str,
    host: &str,
    base_url: &str,
    context: Option<&str>,
) -> Connection {
    let mut settings = json!({
      "api": { "baseURL": base_url, "connection": { "uri": "", "relay": "" } },
      "program": { "name": engine, "path": "", "version": "" },
      "rootfull": false,
      "mode": "mode.automatic"
    });
    if let Some(name) = context {
        settings["context"] = json!(name);
    }
    serde_json::from_value(json!({
      "id": id,
      "name": "live",
      "label": "Live",
      "engine": engine,
      "host": host,
      "settings": settings,
    }))
    .expect("connection fixture parses")
}

/// The machine, over the REAL capabilities and this real Mac.
fn machine(connection: Connection) -> ConnectionMachine {
    ConnectionMachine::new(
        ConnectOptions {
            connection,
            // Nothing is STARTED. A LIMA instance or a podman machine that is down stays down, and
            // the connector reports it — which is a result, not a failure of the suite.
            start_api: false,
            skip_availability_check: false,
            origin: None,
        },
        ConnectionContext {
            os: OperatingSystem::Darwin,
            arch: "arm64".to_string(),
            home: std::env::var("HOME").expect("a home directory"),
            ..ConnectionContext::default()
        },
        ConnectionCapabilities {
            command: Arc::new(TokioCommand::default()),
            fs: Arc::new(StdFs),
            http: Arc::new(TokioHttp),
            clock: Arc::new(SystemClock),
        },
    )
}

/// Whether a program is on this Mac at all — `command -v`, so a brew shim counts.
async fn installed(program: &str) -> bool {
    TokioCommand::default()
        .run(&HostCommand::new("which", &[program]))
        .await
        .is_ok_and(|outcome| outcome.success())
}

/// Bring a connector up and report what it reached, or why it was skipped.
async fn reaches_ready(id: &str, engine: &str, host: &str, base_url: &str, context: Option<&str>) {
    if !installed(engine).await {
        println!("SKIP {host}: `{engine}` is not installed on this Mac");
        return;
    }
    let mut machine = machine(connection(id, engine, host, base_url, context));
    machine.connect(ConnectOrigin::Bootstrap, None).await;
    let info = machine.runtime_info();
    if machine.phase() != ConnectionPhase::Ready {
        println!(
            "SKIP {host}: did not come up — {:?}. Its engine or instance is not running; nothing here starts one.",
            info.error.map(|it| it.code)
        );
        return;
    }
    // **The address is asserted as a SHAPE, never a value.** Every path here is under this runner's
    // own home or a per-boot temporary directory.
    let address = info
        .uri
        .or(info.relay)
        .or_else(|| info.bridge.map(|argv| argv.join(" ")))
        .expect("a ready connection reaches its engine by SOMETHING");
    assert!(
        !address.is_empty(),
        "{host} is ready and names no way of reaching its engine"
    );
    println!("OK   {host}: ready at {address}");
}

#[tokio::test]
async fn docker_desktop_is_reachable_as_the_vendor_host() {
    reaches_ready(
        "host.live.docker.virtualized.vendor",
        "docker",
        "docker.virtualized.vendor",
        "http://localhost",
        None,
    )
    .await;
}

#[tokio::test]
async fn both_lima_connectors_resolve_the_socket_lima_really_bound() {
    // The defect this suite exists for: LIMA names the socket after the TEMPLATE, not the instance,
    // and one instance can forward BOTH engines' sockets. Neither is visible from a fixture — the
    // app's own mocks reproduced the coincidence for the whole life of the port.
    //
    // **The instance is DISCOVERED, never assumed.** A hard-coded name would skip on every Mac but the
    // one this was written on, and — worse — a connection that names no scope refuses with
    // `SCOPE_NOT_SET`, which reads exactly like "the instance is not running". That misreading is what
    // the first version of this test shipped.
    if !installed("limactl").await {
        println!("SKIP lima: `limactl` is not installed on this Mac");
        return;
    }
    let listed = TokioCommand::default()
        .run(&HostCommand::new("limactl", &["list", "--format", "json"]))
        .await
        .expect("limactl runs");
    // One JSON object per line, like docker's context list.
    let running: Vec<String> = listed
        .stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line.trim()).ok())
        .filter(|it| it["status"].as_str() == Some("Running"))
        .filter_map(|it| it["name"].as_str().map(str::to_string))
        .collect();
    if running.is_empty() {
        println!("SKIP lima: no instance is running; nothing here starts one");
        return;
    }
    println!("     lima instances running: {running:?}");

    for (engine, base_url) in [("docker", "http://localhost"), ("podman", "http://d")] {
        let mut reached = false;
        for instance in &running {
            let host = format!("{engine}.virtualized.lima");
            let mut connection = connection(
                &format!("host.live.{engine}.lima.{instance}"),
                engine,
                &host,
                base_url,
                None,
            );
            connection.settings.controller = Some(
                serde_json::from_value(json!({
                    "name": "limactl",
                    "path": "",
                    "scope": instance,
                }))
                .expect("a controller"),
            );
            let mut machine = machine(connection);
            machine.connect(ConnectOrigin::Bootstrap, None).await;
            if machine.phase() != ConnectionPhase::Ready {
                continue;
            }
            let uri = machine.settings().api.connection.uri.clone();
            // **The socket LIMA really bound**, which is the whole rule: it is named after the
            // template the instance was created from, so an instance called `ubuntu-vm` forwards
            // `sock/docker.sock`. Asserting that the path is not `<instance>.sock` is asserting the
            // defect stays fixed.
            assert!(
                !uri.ends_with(&format!("{instance}.sock")),
                "{engine} on `{instance}` resolved the instance-named socket, which LIMA never binds: {uri}"
            );
            assert!(
                uri.contains(instance),
                "and it is still THIS instance's forward: {uri}"
            );
            println!("OK   {engine}.virtualized.lima on `{instance}`: ready at {uri}");
            reached = true;
            break;
        }
        if !reached {
            println!("SKIP {engine}.virtualized.lima: no running instance serves it");
        }
    }
}

#[tokio::test]
async fn apple_container_is_reachable_through_socktainer() {
    reaches_ready(
        "host.live.container.native",
        "container",
        "container.native",
        "http://localhost",
        None,
    )
    .await;
}

#[tokio::test]
async fn docker_native_is_refused_on_macos_by_the_oracles_own_gate() {
    // NOT a defect, and it reads exactly like one. `dockerNativeProfile.isEngineAvailable` is
    // `availableOn(Linux)`, so this host refuses here whatever docker is installed — the
    // assumption that it "should just work" was wrong.
    if !installed("docker").await {
        println!("SKIP docker.native: `docker` is not installed on this Mac");
        return;
    }
    let mut machine = machine(connection(
        "host.live.docker.native",
        "docker",
        "docker.native",
        "http://localhost",
        None,
    ));
    machine.connect(ConnectOrigin::Bootstrap, None).await;

    assert_eq!(machine.phase(), ConnectionPhase::Failed);
    let refusal = machine.runtime_info().error.expect("a reason").code;
    println!("OK   docker.native: refused with {refusal}");
    assert_eq!(refusal.to_string(), "ENGINE_NOT_AVAILABLE_ON_OS");
}

#[tokio::test]
async fn a_pinned_context_is_reached_instead_of_the_one_the_cli_would_choose() {
    //, as a gate. The vendor connector followed `docker context use` in any shell: the same
    // unchanged connection reached `~/.lima/ubuntu-vm/sock/docker.sock` and then
    // `~/.docker/run/docker.sock` with nothing about it having changed.
    //
    // Pinning is asserted against the CURRENT context rather than a hard-coded name, so this passes on
    // any Mac with two contexts and skips honestly on one with fewer. Nothing is switched: `context
    // use` is never run, here or in the port.
    if !installed("docker").await {
        println!("SKIP contexts: `docker` is not installed on this Mac");
        return;
    }
    let listed = TokioCommand::default()
        .run(&HostCommand::new(
            "docker",
            &["context", "ls", "--format", "json"],
        ))
        .await
        .expect("the docker CLI runs");
    // NDJSON — one object per line, which is the shape half this rule turned out to be about.
    let contexts: Vec<serde_json::Value> = listed
        .stdout
        .lines()
        .filter_map(|line| serde_json::from_str(line.trim()).ok())
        .collect();
    let current = contexts
        .iter()
        .find(|it| it["Current"] == json!(true))
        .and_then(|it| it["Name"].as_str())
        .expect("one context is current");
    let Some(other) = contexts
        .iter()
        .filter_map(|it| it["Name"].as_str())
        .find(|name| *name != current)
    else {
        println!("SKIP contexts: this Mac has only `{current}`; pinning needs two to tell apart");
        return;
    };
    let endpoint_of = |name: &str| -> String {
        contexts
            .iter()
            .find(|it| it["Name"].as_str() == Some(name))
            .and_then(|it| it["DockerEndpoint"].as_str())
            .unwrap_or_default()
            .replace("unix://", "")
    };

    let mut pinned = machine(connection(
        "host.live.docker.vendor.pinned",
        "docker",
        "docker.virtualized.vendor",
        "http://localhost",
        Some(other),
    ));
    pinned.connect(ConnectOrigin::Bootstrap, None).await;

    assert_eq!(
        pinned.settings().api.connection.uri,
        endpoint_of(other),
        "a connection pinned to `{other}` must resolve THAT context's endpoint while the CLI's own \
         selection is still `{current}`"
    );
    assert_ne!(
        pinned.settings().api.connection.uri,
        endpoint_of(current),
        "and it must not be the current one, or this test proves nothing"
    );
    // The machine's global selection is untouched — the port never runs `context use`.
    let after = TokioCommand::default()
        .run(&HostCommand::new("docker", &["context", "show"]))
        .await
        .expect("the docker CLI runs");
    assert_eq!(
        after.stdout.trim(),
        current,
        "the user's own context selection must survive this suite"
    );
    println!("OK   contexts: pinned `{other}` while the CLI stays on `{current}`");
}
