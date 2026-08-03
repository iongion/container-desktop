//! A SCOPED connection through the machine.
//!
//! `machine.rs` covers the native sub-step order and `machine_edges.rs` the branches a healthy
//! connection never reaches. What is specified here is the sub-step native hosts pass through in one
//! instant: `StartingScope`. A remote connection must prove the host can run a command BEFORE
//! detection asks it anything, and the probe's argv is asserted WHOLE, because the failure this
//! prevents is not an error — it is asking the LOCAL machine and reporting the answer as the remote's.
//!
//! The data plane that sub-step 3 opens is `machine_forward.rs`; the preflight that explains a scope
//! which will not come up is `machine_preflight.rs`.

use crate::harness::{
    Harness, docker_remote, engine_is_healthy, linux, linux_offering, options, podman,
    podman_remote, remote_is_healthy, ssh_scope, windows_offering_nothing, wsl_connection,
    wsl_is_healthy,
};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::machine::{ControllerScope, WslDistribution};
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectionPhase, ConnectionStartingStep};
use serde_json::json;

/// The whole `ssh` invocation the fixtures below run `command` through.
fn through_ssh(command: &[&str]) -> Vec<String> {
    let mut expected: Vec<String> = [
        "ssh",
        "-oStrictHostKeyChecking=accept-new",
        "-oBatchMode=yes",
        "-oConnectTimeout=15",
        "-oConnectionAttempts=1",
        "-p",
        "22",
        "tester@192.168.122.5",
        "--",
    ]
    .iter()
    .map(|it| (*it).to_string())
    .collect();
    expected.extend(command.iter().map(|it| (*it).to_string()));
    expected
}

/// A remote whose host offers the scope its settings name.
fn remote(scope_named: &str, offered: Vec<ControllerScope>) -> Harness {
    Harness::new(
        options(podman_remote(scope_named), false),
        linux_offering(offered),
        remote_is_healthy,
    )
}

#[tokio::test]
async fn a_scoped_connection_proves_the_host_runs_a_command_before_detection_asks_it_anything() {
    let mut harness = remote("engine", vec![ssh_scope("engine")]);

    let log = harness.connect(0).await;

    // The probe is `echo <sentinel>` — the host has to ECHO, because a shell that prints a banner
    // and exits 0 has not proved it can run the engine's command.
    assert_eq!(
        log.argv.first(),
        Some(&through_ssh(&["echo", "SSH connection established"])),
        "nothing may be asked of the engine before the link itself is proven: {:?}",
        log.argv
    );
    assert_eq!(
        log.argv.get(1),
        Some(&vec!["which".to_string(), "ssh".to_string()]),
        "detection then locates the CONTROLLER on this machine — `ssh` is what reaches the remote, \
         so asking the remote where it is would be circular"
    );
    assert_eq!(
        log.argv.get(3),
        Some(&through_ssh(&["which", "podman"])),
        "and the first question about the ENGINE goes THROUGH the link"
    );
    assert_eq!(
        log.steps().into_iter().flatten().next(),
        Some(ConnectionStartingStep::StartingScope),
        "a scoped host emits the line native hosts pass through in silence"
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
}

#[tokio::test]
async fn a_bridged_remote_publishes_the_command_it_is_reached_by_and_no_local_address() {
    // **This used to assert the derived `cdt-ssh-<id>.sock`, and that address binds nothing.** A
    // podman remote is reached by a stdio BRIDGE — podman answers `dial_stdio_program`, so there is no
    // `ssh -NL` and no socket file anywhere — while `local_forward_fallback` still derives a path and
    // the oracle carries it alongside the bridge (`sshApiConnection`). What a client SHOWS was the
    // open question; the projection now answers it, because it is the one place both facts are known.
    //
    // A missing socket file is not a false ready: this connection works, and `proxy::endpoint` already
    // ranks the bridge first. What changed is that the projection stopped naming an address nothing
    // serves.
    let mut harness = remote("engine", vec![ssh_scope("engine")]);

    harness.connect(0).await;

    let info = harness.machine.runtime_info();
    assert_eq!(
        info.uri, None,
        "no local address is published, because there is none to publish"
    );
    let bridge = info.bridge.expect("a bridged connection says so");
    assert_eq!(bridge.first().map(String::as_str), Some("ssh"));
    assert_eq!(
        bridge
            .iter()
            .rev()
            .take(3)
            .rev()
            .cloned()
            .collect::<Vec<_>>(),
        vec![
            "podman".to_string(),
            "system".to_string(),
            "dial-stdio".to_string()
        ],
        "and it says what it runs on the other side: {bridge:?}"
    );
    assert_eq!(
        info.relay,
        Some("/run/podman.sock".to_string()),
        "the remote socket is still reported — it is where the engine listens over there"
    );
    assert_eq!(info.scope, Some("engine".to_string()));
}

#[tokio::test]
async fn an_unbridged_connection_still_publishes_its_local_address_and_no_bridge() {
    // The other side of the same branch, so the assertion above is not simply true of everything. A
    // native podman has a real local socket and no bridge at all.
    let mut harness = Harness::new(options(podman(), false), linux(None), engine_is_healthy);

    harness.connect(0).await;

    let info = harness.machine.runtime_info();
    assert_eq!(info.bridge, None);
    assert_eq!(info.uri, Some("/run/podman.sock".to_string()));
}

#[tokio::test]
async fn a_scope_that_cannot_run_a_command_fails_the_attempt_and_asks_the_engine_nothing() {
    // A zero exit with the wrong stdout is `StartupStatus::Error`. Continuing to detection here is
    // the bug: `which podman` would then be answered by whatever that shell IS, and reported as the
    // remote's engine.
    let mut harness = Harness::new(
        options(podman_remote("engine"), false),
        linux_offering(vec![ssh_scope("engine")]),
        |argv| {
            if argv.contains(&"echo") {
                return CommandExecutionResult::ok("Welcome to Ubuntu 24.04\n");
            }
            // The preflight's own probes: a working `ssh`, and a link that answers when asked again.
            CommandExecutionResult::ok("OpenSSH_9.6p1")
        },
    );

    let log = harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert!(
        !log.argv.iter().any(|argv| argv.contains(&"which".to_string())
            || argv.contains(&"podman".to_string())),
        "a host that cannot run a command is asked nothing but why: {:?}",
        log.argv
    );
    assert_eq!(
        log.argv.get(1).map(Vec::as_slice),
        Some(["ssh".to_string(), "-V".to_string()].as_slice()),
        "and the explanation starts at the client"
    );
}

#[tokio::test]
async fn a_scope_name_that_matches_nothing_the_host_offers_is_reported_as_not_found() {
    // The scope is a NAME in the settings and a VALUE in the transport, and the host is what
    // resolves one to the other. A name nobody offers is a different failure from a name nobody set,
    // and they need different fixes.
    let mut harness = remote("missing", vec![ssh_scope("engine")]);

    let log = harness.connect(0).await;

    assert!(log.argv.is_empty(), "nothing ran: {:?}", log.argv);
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ScopeNotFound);
    assert_eq!(
        error.params.get("scope").and_then(|it| it.as_str()),
        Some("missing"),
        "the client renders which scope was missing, so the parameters carry it"
    );
    assert_eq!(
        error
            .params
            .get("available")
            .and_then(|it| it.as_array())
            .map(|it| it.iter().filter_map(|it| it.as_str()).collect::<Vec<_>>()),
        Some(vec!["engine"]),
        "and which ones there are instead, so the fix does not need a second screen"
    );
}

#[tokio::test]
async fn a_scope_only_the_host_can_list_is_resolved_by_asking_the_transport() {
    // **The caller's list is `~/.ssh/config` and a WSL distribution is never in it.** `cdc-server`
    // fills `ConnectionContext::scopes` from the ssh config alone, so a connection naming a
    // distribution had nothing to resolve against and was refused as NOT FOUND — on a machine where
    // `wsl -l -v` lists it. Driven on win11: `SCOPE_NOT_FOUND` with `available: []` against a running
    // `podman-machine-default`.
    //
    // The original resolves a NAMED scope by asking the transport — `isControllerScopeAvailable` ->
    // `getControllerScopes` -> `transport.listScopes` — which is the only thing that knows what the
    // host offers. The caller's list stays FIRST, because reading `~/.ssh/config` is the one listing
    // the runtime genuinely cannot do.
    let mut harness = Harness::new(
        options(wsl_connection("podman", "podman-machine-default"), false),
        windows_offering_nothing(),
        wsl_is_healthy,
    );

    harness.connect(0).await;

    assert_ne!(
        harness.machine.runtime_info().error.map(|it| it.code),
        Some(DiagnosticCode::ScopeNotFound),
        "the host lists this distribution; nothing may refuse it as missing"
    );
}

#[tokio::test]
async fn a_scoped_connection_with_no_scope_named_refuses_before_running_anything() {
    let mut harness = remote("", vec![ssh_scope("engine")]);

    let log = harness.connect(0).await;

    assert!(log.argv.is_empty(), "nothing ran: {:?}", log.argv);
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.runtime_info().error.expect("a reason").code,
        DiagnosticCode::ScopeNotSet
    );
}

/// The other three scope kinds. Each carries the same `Name` field, which is the only thing
/// selection reads.
fn other_kinds() -> Vec<ControllerScope> {
    vec![
        ControllerScope::WslDistribution(wsl("wsl-engine")),
        ControllerScope::LimaInstance(
            serde_json::from_value(json!({
                "Name": "lima-engine", "Type": "LIMAInstance", "Status": "Running",
                "Dir": "/home/tester/.lima/lima-engine", "Arch": "x86_64", "CPUs": "4",
                "Memory": "4GiB", "Disk": "100GiB", "SSH": "127.0.0.1:60022"
            }))
            .expect("lima fixture parses"),
        ),
        ControllerScope::PodmanMachine(
            serde_json::from_value(json!({
                "Name": "podman-machine-default", "Type": "PodmanMachine", "Active": true,
                "Created": "now", "LastUp": "now", "Running": true, "Usable": true,
                "VMType": "qemu"
            }))
            .expect("machine fixture parses"),
        ),
    ]
}

fn wsl(name: &str) -> WslDistribution {
    serde_json::from_value(json!({
        "Name": name, "Type": "WSLDistribution", "Version": "2", "Default": false,
        "Current": false, "State": "Running"
    }))
    .expect("wsl fixture parses")
}

#[tokio::test]
async fn a_scope_of_the_wrong_kind_is_refused_by_the_transport_that_cannot_use_it() {
    // A scope resolves by NAME, so a host can offer a WSL distribution called `engine` to an SSH
    // transport. The transport refuses it by kind rather than reading it as a missing scope — and
    // nothing is run, because there is no link to run it over.
    let mut scopes = other_kinds();
    scopes.push(ControllerScope::WslDistribution(wsl("engine")));
    let mut harness = remote("engine", scopes);

    let log = harness.connect(0).await;

    assert!(log.argv.is_empty(), "nothing ran: {:?}", log.argv);
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ScopeNotSet);
    assert_eq!(
        error.params.get("scope").and_then(|it| it.as_str()),
        Some("WSLDistribution"),
        "the diagnostic names the schema's own scope type, not a hand-written label"
    );
}

#[tokio::test]
async fn a_scope_selected_by_name_ignores_every_other_kind_the_host_offers() {
    // Selection reads only the name, so a host offering all four kinds still finds the SSH one.
    let mut scopes = other_kinds();
    scopes.push(ssh_scope("engine"));
    let mut harness = remote("engine", scopes);

    let log = harness.connect(0).await;

    assert_eq!(
        log.argv.first(),
        Some(&through_ssh(&["echo", "SSH connection established"]))
    );
}

#[tokio::test]
async fn a_native_connection_still_passes_through_the_scope_step_in_one_instant() {
    // The regression a scoped sub-step could cause. Native has no scope, so `StartingScope` is
    // entered and left in the same instant and emits NO progress line — which is what the app's
    // trace stream does.
    let mut harness = Harness::new(
        options(podman(), false),
        linux_offering(vec![ssh_scope("engine")]),
        engine_is_healthy,
    );

    let log = harness.connect(0).await;

    assert!(
        !log.steps()
            .contains(&Some(ConnectionStartingStep::StartingScope)),
        "a native host announces no scope step: {:?}",
        log.steps()
    );
    assert!(
        !log.argv.iter().any(|argv| argv[0] == "ssh"),
        "and never runs ssh: {:?}",
        log.argv
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
}

#[tokio::test]
async fn a_scope_a_host_offers_none_of_is_still_not_found_rather_than_not_set() {
    // A host with no scopes at all: the settings name one, so the user DID configure something and
    // must not be told they did not.
    let mut harness = Harness::new(
        options(podman_remote("engine"), false),
        linux(None),
        remote_is_healthy,
    );

    harness.connect(0).await;

    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ScopeNotFound);
    assert_eq!(
        error.params.get("available").and_then(|it| it.as_array()),
        Some(&vec![]),
        "and the empty list is what says there is nothing to pick instead"
    );
}

#[tokio::test]
async fn a_scoped_connections_contexts_are_listed_inside_its_scope() {
    // **The one thing `ConnectionMachine::list_contexts` adds over the dialect's own method.** A
    // listing run on THIS machine would answer about the wrong docker entirely — the local one — and
    // look like a perfectly good list while doing it.
    //
    // DOCKER, deliberately: podman answers the trait's empty default without running anything, so the
    // same test on a podman remote asserts nothing at all — every claim below would hold against a
    // listing that never happened.
    let harness = Harness::new(
        options(docker_remote("engine"), false),
        linux_offering(vec![ssh_scope("engine")]),
        |argv| {
            if argv.contains(&"ls") {
                return CommandExecutionResult::ok(
                    "{\"Name\":\"desktop-linux\",\"DockerEndpoint\":\"unix:///d.sock\",\"Current\":true}",
                );
            }
            remote_is_healthy(argv)
        },
    );

    let listed = harness
        .machine
        .list_contexts()
        .await
        .expect("a scope the host offers is attached");

    assert_eq!(
        listed.iter().map(|it| it.name.as_str()).collect::<Vec<_>>(),
        vec!["desktop-linux"]
    );
    let argv = harness.argv();
    assert!(!argv.is_empty(), "the listing did run something");
    assert!(
        argv.iter()
            .all(|it| it.first().map(String::as_str) == Some("ssh")),
        "and every command it ran went through the scope: {argv:?}"
    );
}

#[tokio::test]
async fn listing_contexts_for_a_scope_the_host_does_not_offer_is_refused_rather_than_answered_locally()
 {
    // The same refusal a connect gets, and for the identical reason: with no scope attached the
    // client would run the command HERE and answer confidently about the wrong machine.
    let harness = Harness::new(
        options(docker_remote("engine"), false),
        linux_offering(Vec::new()),
        remote_is_healthy,
    );

    let refusal = harness
        .machine
        .list_contexts()
        .await
        .expect_err("a scope that is not there cannot be listed inside");

    assert_eq!(refusal.code, DiagnosticCode::ScopeNotFound);
    assert!(
        harness.argv().is_empty(),
        "and nothing was run locally on the way to that refusal: {:?}",
        harness.argv()
    );
}

#[tokio::test]
async fn a_wsl_connection_publishes_its_bridge_and_never_the_pipe_nothing_binds() {
    // **The wsl-relay question, answered by the projection rather than by a relay process.**
    // `WslTransport::resolve_scope_uri` IMPOSES `\\.\pipe\<id>` as this connection's address, because
    // that is what the original's `wsl-relay.ts` binds — and this port has no relay, so nothing
    // binds it.
    //
    // It is not built, deliberately: the direct stdio path already REACHES the engine, so a relay
    // would buy only a third party's ability to dial the same connection, at the price of a process
    // per connection and a second data plane — the shape this core avoids, and the one
    // the design forbids elsewhere for the same reason. What the gap really cost was a connection
    // ADVERTISING an address nothing serves, and that is a projection question, settled here.
    let mut harness = Harness::new(
        options(wsl_connection("podman", "podman-machine-default"), false),
        windows_offering_nothing(),
        wsl_is_healthy,
    );

    harness.connect(0).await;

    let info = harness.machine.runtime_info();
    assert_eq!(
        info.uri, None,
        "no pipe is advertised, because no relay binds one"
    );
    let bridge = info
        .bridge
        .expect("a WSL connection is reached by a bridge");
    // What it SAYS, rather than argv[0]: the launcher here is whatever the fixture's `which` answered,
    // and the fact under test is that the projection carries the distribution and the engine's own
    // dial-stdio — the route that really reaches the engine, in place of the pipe that does not.
    assert!(
        bridge.windows(2).any(|pair| pair
            == [
                "--distribution".to_string(),
                "podman-machine-default".to_string()
            ]),
        "it enters the distribution: {bridge:?}"
    );
    assert_eq!(
        bridge
            .iter()
            .rev()
            .take(2)
            .rev()
            .cloned()
            .collect::<Vec<_>>(),
        vec!["system".to_string(), "dial-stdio".to_string()],
        "and speaks the engine's own bridge at the end of it: {bridge:?}"
    );
}
