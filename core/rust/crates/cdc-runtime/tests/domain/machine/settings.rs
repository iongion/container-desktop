//! What an attempt RESOLVES, and what becomes of it.
//!
//! Not cosmetic: the next attempt starts from these settings, and the Connection Info screen renders
//! them. The rule they all serve is that a live refresh must never ERASE what the user configured
//! with an empty answer — which is why the resolved settings are merged into the connection's rather
//! than replacing them.

use crate::fakes::FakeCommand;
use crate::harness::{Harness, engine_is_healthy, linux, options, sockets_bound};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::types::connection::Connection;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::resource_sync_protocol::ConnectionPhase;
use serde_json::json;

fn connection(mode: &str, path: &str, uri: &str) -> Connection {
    serde_json::from_value(json!({
      "id": "host.default.podman.native",
      "name": "Native",
      "label": "Native",
      "engine": "podman",
      "host": "podman.native",
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": uri, "relay": "" } },
        "program": { "name": "podman", "path": path, "version": "5.6.2" },
        "rootfull": false,
        "mode": mode
      }
    }))
    .expect("connection fixture parses")
}

/// A healthy engine that reports `/detected.sock`, so what detection found is distinguishable from
/// whatever the connection was configured with.
fn reports_detected_socket(argv: &[&str]) -> CommandExecutionResult {
    match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
        [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/detected.sock"}}}"#),
    }
}

fn harness_for(connection: Connection, respond: fn(&[&str]) -> CommandExecutionResult) -> Harness {
    // Both sockets these fixtures name are BOUND: the question here is which uri gets PERSISTED, and
    // an unbound socket would answer it with an availability refusal instead.
    Harness::with_fs(
        options(connection, false),
        linux(None),
        FakeCommand::answering(respond),
        sockets_bound(&["/detected.sock", "/configured.sock"]),
    )
}

#[tokio::test]
async fn what_an_attempt_resolved_becomes_the_connections_settings_once_it_succeeds() {
    let mut harness = harness_for(
        connection("mode.automatic", "", "/configured.sock"),
        reports_detected_socket,
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert_eq!(
        harness.machine.connection().settings.api.connection.uri,
        "/detected.sock",
        "what detection found is adopted"
    );
    assert_eq!(
        harness.machine.settings().program.path.as_deref(),
        Some("/usr/bin/podman")
    );
}

#[tokio::test]
async fn a_socket_the_engine_cannot_report_falls_back_to_the_configured_one() {
    let mut harness = harness_for(
        connection("mode.manual", "/usr/bin/podman", "/configured.sock"),
        engine_is_healthy,
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert_eq!(
        harness.machine.connection().settings.api.connection.uri,
        "/configured.sock",
        "the configured socket survives, or the Connection Info screen would blank"
    );
}

#[tokio::test]
async fn a_configured_relay_survives_a_detection_that_reports_none() {
    // The same rule as the socket. A native profile always answers with an empty relay, so an
    // overwrite would blank a configured one on every successful connect.
    let mut relayed = connection("mode.automatic", "", "");
    relayed.settings.api.connection.relay = "/in-guest.sock".to_string();
    let mut harness = harness_for(relayed, reports_detected_socket);

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert_eq!(
        harness.machine.connection().settings.api.connection.relay,
        "/in-guest.sock"
    );
    assert_eq!(
        harness.machine.runtime_info().uri.as_deref(),
        Some("/detected.sock"),
        "what detection found still wins where it found something"
    );
}

#[tokio::test]
async fn a_relay_is_projected_when_there_is_one() {
    let mut relayed = connection("mode.manual", "/usr/bin/podman", "/local.sock");
    relayed.settings.api.connection.relay = "/in-guest.sock".to_string();
    let mut harness = harness_for(relayed, engine_is_healthy);

    harness.connect(0).await;

    assert_eq!(
        harness.machine.runtime_info().relay.as_deref(),
        Some("/in-guest.sock")
    );
}

#[tokio::test]
async fn the_controller_version_wins_over_the_programs() {
    // `resolveConnectionVersion`: a scoped host reports the version of the engine INSIDE the scope.
    let mut scoped = connection("mode.manual", "/usr/bin/podman", "/run/podman.sock");
    scoped.settings.controller = Some(
        serde_json::from_value(json!({
          "name": "podman",
          "path": "/usr/bin/podman",
          "version": "9.9.9",
          "scope": "podman-machine-default"
        }))
        .expect("controller fixture parses"),
    );
    let mut harness = harness_for(scoped, engine_is_healthy);

    harness.connect(0).await;
    let runtime = harness.machine.runtime_info();

    assert_eq!(runtime.version.as_deref(), Some("9.9.9"));
    assert_eq!(
        runtime.scope.as_deref(),
        Some("podman-machine-default"),
        "the scope is projected too, so a client can say where the engine lives"
    );
}

#[tokio::test]
async fn a_diagnostic_with_no_parameters_carries_none_rather_than_an_empty_object() {
    // `PROGRAM_NOT_FOUND` names the program it looked for; `API_SOCKET_UNRESOLVED` has nothing to
    // say. A client renders the parameters, so inventing an empty set for the second is noise.
    let mut with_parameters = harness_for(
        connection("mode.manual", "", "/run/podman.sock"),
        engine_is_healthy,
    );
    with_parameters.connect(0).await;
    let error = with_parameters
        .machine
        .runtime_info()
        .error
        .expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ProgramNotFound);
    assert_eq!(
        error.params.get("program").and_then(|it| it.as_str()),
        Some("podman"),
        "the client renders which program was looked for"
    );

    let mut without_parameters = harness_for(
        connection("mode.manual", "/usr/bin/podman", ""),
        engine_is_healthy,
    );
    without_parameters.connect(0).await;
    let error = without_parameters
        .machine
        .runtime_info()
        .error
        .expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ApiSocketUnresolved);
    assert!(
        error.params.is_empty(),
        "nothing to say, so nothing is said: {:?}",
        error.params
    );
}

#[tokio::test]
async fn a_failed_attempt_adopts_nothing() {
    // Adoption happens on the way to `ready` and nowhere else. A native profile ranks
    // `readEngineSocket() || seed` and does NOT consider the configured address, so an engine that
    // reports no socket resolves to an empty one — and if that were adopted, the user's configured
    // address would be gone and every later attempt would start from the blank.
    let mut harness = harness_for(
        connection("mode.automatic", "", "/configured.sock"),
        |argv| match argv {
            ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
            [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
            _ => CommandExecutionResult::ok("{}"),
        },
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.settings().api.connection.uri,
        "",
        "the attempt itself resolved nothing — that is why it failed"
    );
    assert_eq!(
        harness.machine.connection().settings.api.connection.uri,
        "/configured.sock",
        "and the connection still carries what the user configured"
    );
}
