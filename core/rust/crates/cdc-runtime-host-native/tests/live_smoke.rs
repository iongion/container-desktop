//! Live smoke test. NOT part of the default `cargo test`.
//!
//! `cargo test -p cdc-runtime-host-native --features live-smoke --test live_smoke`
//!
//! Everything else in this workspace is hermetic, which is what makes it trustworthy and also what
//! makes it blind to one failure: a capability that compiles, passes its fakes, and cannot actually
//! talk to an engine. This runs the real connection against the real podman on this machine.
//!
//! It is a smoke test, not a conformance test. It asserts shapes — a path, a parsed version, a
//! socket — never exact values, because those differ per machine and a corpus scenario is where
//! exactness belongs.

#![cfg(feature = "live-smoke")]

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

fn podman_native() -> Connection {
    serde_json::from_value(json!({
      "id": "host.live.podman.native",
      "name": "live",
      "label": "Live",
      "engine": "podman",
      "host": "podman.native",
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": "", "relay": "" } },
        "program": { "name": "podman", "path": "", "version": "" },
        "rootfull": false,
        "mode": "mode.automatic"
      }
    }))
    .expect("connection fixture parses")
}

#[tokio::test]
async fn the_capability_can_actually_spawn_a_process() {
    let outcome = TokioCommand::default()
        .run(&HostCommand::new("podman", &["--version"]))
        .await
        .expect("podman must be installed to run the live smoke test");

    assert!(outcome.success(), "podman --version failed: {outcome:?}");
    assert!(
        outcome.stdout.starts_with("podman version"),
        "unexpected output: {}",
        outcome.stdout
    );
}

#[tokio::test]
async fn detection_finds_the_real_podman_on_this_machine() {
    // The whole composition, not the detection function alone: the units perform their own I/O now,
    // so what a live run has to prove is that the REAL transport, dialect and profile reach an engine
    // through the real capability.
    let mut machine = ConnectionMachine::new(
        ConnectOptions {
            connection: podman_native(),
            start_api: false,
            skip_availability_check: false,
            origin: None,
        },
        ConnectionContext {
            os: OperatingSystem::Linux,
            ..ConnectionContext::default()
        },
        ConnectionCapabilities {
            command: Arc::new(TokioCommand::default()),
            fs: Arc::new(StdFs),
            http: Arc::new(TokioHttp),
            clock: Arc::new(SystemClock),
        },
    );

    machine.connect(ConnectOrigin::Bootstrap, None).await;

    let settings = machine.settings();
    println!("live: {settings:#?}");
    assert_eq!(
        machine.phase(),
        ConnectionPhase::Ready,
        "the connection failed: {:?}",
        machine.runtime_info().error
    );
    assert!(
        settings
            .program
            .path
            .as_deref()
            .is_some_and(|it| it.ends_with("podman")),
        "expected a podman path, got {:?}",
        settings.program.path
    );
    let version = settings
        .program
        .version
        .as_deref()
        .expect("a version was parsed");
    assert!(
        version.chars().next().is_some_and(|it| it.is_ascii_digit()),
        "expected a numeric version, got {version}"
    );
    assert!(
        !settings.api.connection.uri.is_empty(),
        "the engine reported no socket — is the podman service running?"
    );
}
