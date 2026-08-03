//! Automatic-settings detection.
//!
//! The ORDER is the specification: the OS gate first, then the program, then the engine's socket,
//! and only then the ranking that composes the API connection. `detect_scoped.rs` runs the same
//! sequence through a scope.

mod scoped;

use crate::fakes::{FakeCommand, unit_host, unit_settings};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::detect::detect_automatic_settings;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::EngineEnvironment;
use cdc_runtime::runtimes::dialects::docker::DockerDialect;
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::profiles::docker::DockerNativeProfile;
use cdc_runtime::runtimes::profiles::podman::PodmanNativeProfile;
use cdc_runtime::runtimes::transports::native::NativeTransport;

fn podman_host(
    os: OperatingSystem,
    respond: fn(&[&str]) -> CommandExecutionResult,
) -> (
    cdc_runtime::runtimes::host_client::HostClient,
    std::sync::Arc<std::sync::Mutex<crate::fakes::Asked>>,
) {
    let command = FakeCommand::answering(respond);
    let log = command.log();
    (
        unit_host(
            "host.default.podman.native",
            Box::new(NativeTransport),
            Box::new(PodmanDialect),
            Box::new(PodmanNativeProfile),
            os,
            command,
        ),
        log,
    )
}

#[tokio::test]
async fn detection_finds_the_program_then_asks_the_engine_where_it_listens() {
    let (host, log) = podman_host(OperatingSystem::Linux, |argv| match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
        [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => CommandExecutionResult::ok(
            r#"{"host":{"remoteSocket":{"path":"unix:///run/podman.sock"}}}"#,
        ),
    });

    let resolved =
        detect_automatic_settings(&host, &unit_settings(), &EngineEnvironment::default())
            .await
            .expect("linux podman detects");

    assert_eq!(resolved.program.path.as_deref(), Some("/usr/bin/podman"));
    assert_eq!(resolved.program.version.as_deref(), Some("5.6.2"));
    assert_eq!(resolved.api.connection.uri, "/run/podman.sock");
    assert_eq!(
        log.lock().expect("asked").argv[2][0],
        "/usr/bin/podman",
        "the socket probe uses the path the lookup JUST resolved, not the one that came in"
    );
}

#[tokio::test]
async fn an_engine_the_os_cannot_run_refuses_before_a_single_command() {
    let (host, log) = podman_host(OperatingSystem::Darwin, |_| {
        CommandExecutionResult::ok("/usr/bin/podman")
    });

    let refusal = detect_automatic_settings(&host, &unit_settings(), &EngineEnvironment::default())
        .await
        .expect_err("podman.native is Linux only");

    assert_eq!(refusal.code, DiagnosticCode::EngineNotAvailableOnOs);
    assert!(
        log.lock().expect("asked").argv.is_empty(),
        "the gate is first precisely so nothing is probed"
    );
}

#[tokio::test]
async fn podman_keeps_the_environment_seed_when_the_engine_cannot_be_asked() {
    // `uri = readEngineSocket() || seed`. Podman keeps the seed; Docker discards it, and that
    // asymmetry is in the original.
    let (host, _) = podman_host(OperatingSystem::Linux, |argv| match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
        [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => CommandExecutionResult::failed(125, "cannot connect"),
    });
    let environment = EngineEnvironment {
        podman_host: Some("unix:///seeded.sock".to_string()),
        docker_host: None,
    };

    let resolved = detect_automatic_settings(&host, &unit_settings(), &environment)
        .await
        .expect("detects");

    assert_eq!(resolved.api.connection.uri, "unix:///seeded.sock");
}

#[tokio::test]
async fn docker_discards_the_seed_when_the_context_cannot_be_read() {
    let command = FakeCommand::answering(|argv| match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/docker\n"),
        [_, "--version"] => CommandExecutionResult::ok("Docker version 27.0.0"),
        _ => CommandExecutionResult::failed(1, "no context"),
    });
    let host = unit_host(
        "host.default.docker.native",
        Box::new(NativeTransport),
        Box::new(DockerDialect),
        Box::new(DockerNativeProfile),
        OperatingSystem::Linux,
        command,
    );
    let environment = EngineEnvironment {
        podman_host: None,
        docker_host: Some("unix:///seeded.sock".to_string()),
    };

    let resolved = detect_automatic_settings(&host, &unit_settings(), &environment)
        .await
        .expect("detects");

    assert_eq!(
        resolved.api.connection.uri, "",
        "the asymmetry with Podman is preserved rather than smoothed over"
    );
}

#[tokio::test]
async fn detection_re_resolves_the_path_rather_than_trusting_the_stored_one() {
    // A moved binary must not keep resolving to its old location, which is why the lookup starts
    // from the NAME every time.
    let (host, _) = podman_host(OperatingSystem::Linux, |argv| match argv {
        ["which", ..] => CommandExecutionResult::ok("/opt/podman/bin/podman\n"),
        [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/p.sock"}}}"#),
    });
    let mut stale = unit_settings();
    stale.program.path = Some("/usr/bin/podman".to_string());

    let resolved = detect_automatic_settings(&host, &stale, &EngineEnvironment::default())
        .await
        .expect("detects");

    assert_eq!(
        resolved.program.path.as_deref(),
        Some("/opt/podman/bin/podman")
    );
}
