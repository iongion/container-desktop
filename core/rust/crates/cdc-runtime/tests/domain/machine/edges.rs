//! The connection machine's edges: the branches a healthy connection never reaches.
//!
//! `machine.rs` covers the sub-step order and `machine_reconnect.rs` the back-off. Here: the two ways
//! to skip a sub-step, a disabled connection, a service that fails after being asked for, the OS gate
//! reached late, and the two accessors a server reads state through.
//!
//! What the settings an attempt RESOLVES become is `machine_settings.rs`.

use crate::fakes::APP_VERSION;
use crate::fakes::FakeCommand;
use crate::harness::{Harness, engine_is_healthy, linux, options};
use cdc_runtime::capabilities::command::{CommandExecutionResult, ReadinessCheck};
use cdc_runtime::capabilities::http::Endpoint;
use cdc_runtime::domain::machine::ConnectionContext;
use cdc_runtime::domain::reconnect::{BackoffSchedule, ResolvedReconnectPolicy};
use cdc_runtime::domain::types::connection::{ConnectOptions, Connection};
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{
    ConnectOrigin, ConnectionPhase, ConnectionStartingStep,
};
use cdc_runtime::runtimes::transports::native::{API_READINESS_ATTEMPTS, API_READINESS_WAIT};
use serde_json::json;

/// A native connection, spelled out because these tests turn each of its fields in isolation.
fn connection(host: &str, mode: &str, path: &str, uri: &str) -> Connection {
    serde_json::from_value(json!({
      "id": format!("host.default.{host}"),
      "name": "Native",
      "label": "Native",
      "engine": host.split('.').next().unwrap_or("podman"),
      "host": host,
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": uri, "relay": "" } },
        "program": { "name": "podman", "path": path, "version": "5.6.2" },
        "rootfull": false,
        "mode": mode
      }
    }))
    .expect("connection fixture parses")
}

fn podman_at(path: &str, uri: &str) -> Connection {
    connection("podman.native", "mode.manual", path, uri)
}

fn harness_for(connection: Connection, start_api: bool, skip_availability_check: bool) -> Harness {
    Harness::new(
        ConnectOptions {
            connection,
            start_api,
            skip_availability_check,
            origin: None,
        },
        linux(None),
        engine_is_healthy,
    )
}

#[tokio::test]
async fn a_remote_connection_with_no_controller_at_all_refuses_rather_than_running_locally() {
    // Not merely an empty `scope` — this connection has no `controller` block whatsoever, so there is
    // no name to resolve and no host to run on. Refusing is the only safe answer: running the probe
    // unwrapped would ask the LOCAL engine and report the reply as the remote's.
    let mut harness = harness_for(
        connection("podman.remote", "mode.automatic", "/usr/bin/podman", ""),
        false,
        false,
    );

    let log = harness.connect(0).await;

    assert!(
        log.argv.is_empty(),
        "nothing may run against the local machine on a remote connection's behalf: {:?}",
        log.argv
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.runtime_info().error.expect("a reason").code,
        DiagnosticCode::ScopeNotSet
    );
}

#[tokio::test]
async fn skipping_the_availability_check_skips_detection_too_and_reports_nothing_checked() {
    // The oracle's `skipAvailabilityCheck` skips BOTH, and `connectOne` then reads `api ?? false` —
    // so the connection is reported unavailable. Faithful, if surprising.
    let mut harness = harness_for(
        connection(
            "podman.native",
            "mode.automatic",
            "/usr/bin/podman",
            "/run/podman.sock",
        ),
        false,
        true,
    );

    let log = harness.connect(0).await;

    assert!(
        log.argv.is_empty(),
        "detection is skipped, so nothing runs: {:?}",
        log.argv
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.runtime_info().error.map(|it| it.code),
        Some(DiagnosticCode::NotChecked),
        "unchecked is not the same as broken, and the code says so rather than inventing a failure"
    );
    assert_eq!(
        log.steps(),
        vec![None, None],
        "no sub-step was performed, so both lines are phase changes"
    );
    assert_eq!(
        log.phases(),
        vec![ConnectionPhase::Starting, ConnectionPhase::Failed],
        "the attempt announcing itself, and then what became of it"
    );
}

#[tokio::test]
async fn a_disabled_connection_is_not_available_however_healthy_the_engine_is() {
    let mut disabled = podman_at("/usr/bin/podman", "/run/podman.sock");
    disabled.disabled = Some(true);
    let mut harness = harness_for(disabled, false, false);

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert!(!harness.machine.availability().enabled);
    assert!(
        harness.machine.availability().host && harness.machine.availability().program,
        "the engine itself is fine — it is the connection that is switched off"
    );
}

#[tokio::test]
async fn an_attempt_that_fails_after_spawning_a_service_stops_it_on_the_way_out() {
    // The orphan the design names as its first risk, on the path nobody looks at: not a disconnect,
    // but a FAILURE after the service was already asked for. Reaching `failed` with the child still
    // running leaves a process holding the connection's socket that no later attempt will ever name.
    let mut disabled = podman_at("/usr/bin/podman", "/run/podman.sock");
    disabled.disabled = Some(true);
    let mut harness = harness_for(disabled, true, false);

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.spawned(),
        vec!["api:host.default.podman.native".to_string()],
        "the service was asked for before availability refused the connection"
    );
    assert_eq!(
        harness.killed(),
        vec!["api:host.default.podman.native".to_string()]
    );
}

#[tokio::test]
async fn a_failed_api_start_lets_the_availability_check_decide() {
    // The oracle catches a `startApi` failure and carries on: the engine may already be listening
    // because something else started it. What must NOT happen is the attempt dying there.
    let mut harness = Harness::over(
        options(podman_at("/usr/bin/podman", "/run/podman.sock"), true),
        linux(None),
        FakeCommand::answering(engine_is_healthy).refusing_services(),
    );

    harness.connect(0).await;

    assert_eq!(
        harness.machine.phase(),
        ConnectionPhase::Ready,
        "the socket address is resolved, and that is all this check asserts"
    );
    assert_eq!(harness.spawned().len(), 1, "and it WAS attempted");
}

#[tokio::test]
async fn a_scheme_on_the_configured_socket_is_stripped_before_the_service_is_started() {
    // `podman system service unix://<path>` — the scheme is added by the dialect, so leaving one on
    // the configured uri would produce `unix://unix:///run/...`.
    let mut harness = harness_for(
        podman_at("/usr/bin/podman", "unix:///run/podman.sock"),
        true,
        false,
    );

    harness.connect(0).await;

    let (_, command, opts) = harness.service();
    assert!(
        command.argv().contains(&"unix:///run/podman.sock"),
        "got {:?}",
        command.argv()
    );
    assert_eq!(
        opts.check_status,
        ReadinessCheck::ApiAnswers {
            endpoint: Endpoint::UnixSocket("/run/podman.sock".to_string()),
            headers: vec![
                ("Host".to_string(), "d".to_string()),
                ("Accept".to_string(), "application/json".to_string()),
                ("Content-Type".to_string(), "application/json".to_string()),
                (
                    "User-Agent".to_string(),
                    format!("Container Desktop {APP_VERSION}")
                ),
            ],
        },
        "the engine is asked over an ADDRESS, so the scheme is gone — and with the same headers a \
         forwarded request carries, or the poll is not asking the question the traffic will ask"
    );
    assert_eq!(
        (opts.retry.count, opts.retry.wait),
        (API_READINESS_ATTEMPTS, API_READINESS_WAIT),
        "`Runner.startApi`'s own ceiling — the engine's, never the tunnel's shorter one"
    );
    assert_eq!(
        command
            .env
            .iter()
            .find(|(key, _)| key == "HTTP_PROXY")
            .map(|(_, value)| value.as_str()),
        Some(crate::fakes::PROXY_URL),
        "a native host IS unscoped, so the engine's service is STARTED with this machine's proxy \
         variables — without them a service behind a corporate proxy cannot pull anything, and this \
         spawn does not pass through `run_host_command`, where every other command picks them up"
    );
    assert_eq!(
        command.timeout, None,
        "and it carries none: the service outlives the call that starts it"
    );
}

#[tokio::test]
async fn a_socket_directory_that_cannot_be_created_is_named_rather_than_spawned_over() {
    // Podman does not create its listening socket's base directory, so the transport does — and a
    // filesystem that refuses is the one case where there is nothing to start. Spawning anyway would
    // leave `podman system service` failing to bind, with the reason only in its own stderr.
    let mut harness = Harness::with_fs(
        options(podman_at("/usr/bin/podman", "/run/cdc/podman.sock"), true),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        crate::fakes::MemoryFs::refusing_mkdir(),
    );

    harness.connect(0).await;

    assert!(
        harness.spawned().is_empty(),
        "nothing was launched: {:?}",
        harness.spawned()
    );
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ApiSocketUnresolved);
    assert_eq!(
        error.params.get("path").and_then(|it| it.as_str()),
        Some("/run/cdc"),
        "the diagnostic names the directory, which is what has to be fixed"
    );
}

#[tokio::test]
async fn a_socket_with_no_directory_in_front_of_it_is_not_created_anywhere() {
    // `Path::new("podman.sock").parent()` is `Some("")`, which is not a directory to make — asking a
    // filesystem to create "" is a call that can only fail, and on the refusing one below it would
    // fail the attempt for a socket the engine would have bound perfectly well.
    let mut harness = Harness::with_fs(
        options(podman_at("/usr/bin/podman", "podman.sock"), true),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        crate::fakes::MemoryFs::refusing_mkdir(),
    );

    harness.connect(0).await;

    assert_eq!(
        harness.spawned(),
        vec!["api:host.default.podman.native".to_string()],
        "nothing had to be created, so nothing was asked of the filesystem"
    );
}

#[tokio::test]
async fn a_socket_at_the_filesystem_root_has_no_directory_to_prepare() {
    // `Path::new("/").parent()` is `None`, and a transport that unwrapped it would panic on a
    // nonsensical-but-parseable setting instead of letting the engine refuse it.
    let mut harness = harness_for(podman_at("/usr/bin/podman", "/"), true, false);

    harness.connect(0).await;

    assert_eq!(
        harness.spawned(),
        vec!["api:host.default.podman.native".to_string()],
        "nothing to create, so the service is started and the engine decides"
    );
}

#[tokio::test]
async fn a_program_found_only_by_name_still_starts_the_service() {
    // `settings.program.path || settings.program.name`: an engine on the PATH of whatever runs the
    // command is still usable.
    let mut harness = harness_for(podman_at("", "/run/podman.sock"), true, false);

    harness.connect(0).await;

    assert_eq!(harness.service().1.launcher, "podman");
}

#[tokio::test]
async fn an_engine_the_operating_system_cannot_run_fails_the_api_check_with_the_os_reason() {
    // Manual settings skip detection, so the OS gate is not reached until the availability check —
    // and the reason the caller sees must be the OS one, not the placeholder and not a socket
    // complaint about a socket that is perfectly well configured.
    let mut harness = Harness::new(
        options(podman_at("/usr/bin/podman", "/run/podman.sock"), false),
        ConnectionContext {
            os: OperatingSystem::Darwin,
            ..ConnectionContext::default()
        },
        engine_is_healthy,
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert!(!harness.machine.availability().host);
    assert!(
        harness.machine.availability().program,
        "the program is configured and present — it is the OS that cannot run the engine"
    );
    assert_eq!(
        harness.machine.availability().report.api.code,
        DiagnosticCode::EngineNotAvailableOnOs,
        "the api verdict repeats the first check that actually failed"
    );
    assert_eq!(
        harness.machine.runtime_info().error.map(|it| it.code),
        Some(DiagnosticCode::EngineNotAvailableOnOs)
    );
}

#[tokio::test]
async fn the_sub_step_a_server_reads_is_cleared_once_the_machine_settles() {
    // `starting_step` is what a client renders under a `starting` phase. A settled machine is doing
    // no sub-step, and leaving the last one showing would have a failed connection permanently
    // "detecting".
    let mut harness = Harness::new(
        options(connection("podman.native", "mode.automatic", "", ""), false),
        linux(None),
        |_| CommandExecutionResult::failed(1, "not found"),
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(harness.machine.starting_step(), None);
    assert_eq!(
        harness
            .connect(1)
            .await
            .steps()
            .into_iter()
            .flatten()
            .next(),
        Some(ConnectionStartingStep::Detecting),
        "and the next attempt announces its own"
    );
}

/// A schedule that ignores the policy, so the injection seam is observable.
#[derive(Debug)]
struct FixedBackoff(u64);

impl BackoffSchedule for FixedBackoff {
    fn delay_ms(&mut self, attempt: u32, _policy: &ResolvedReconnectPolicy) -> u64 {
        self.0 * attempt as u64
    }
}

#[tokio::test]
async fn the_back_off_schedule_is_injectable() {
    // The seam a live scheduler applies jitter through. Nothing in the domain is random, so the only
    // way to prove the seam works is to inject something that is not the default.
    let mut harness = harness_for(
        podman_at("/usr/bin/podman", "/run/podman.sock"),
        false,
        false,
    )
    .with_backoff(Box::new(FixedBackoff(7)));
    harness.connect(0).await;
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);

    harness.dropped(0, DiagnosticCode::ApiUnreachable).await;

    assert_eq!(harness.machine.runtime_info().next_retry_at, Some(7));
    assert!(
        harness.machine.policy().enabled,
        "the policy is still the resolved one — only the schedule was replaced"
    );
}

#[tokio::test]
async fn the_debug_view_says_where_the_machine_is_and_what_it_is_waiting_for() {
    // A failing assertion in any of these tests prints this, so it has to carry the state that
    // explains the failure.
    let mut harness = harness_for(podman_at("/usr/bin/podman", ""), false, false);
    harness.connect(0).await;

    let rendered = format!("{:?}", harness.machine);

    for expected in [
        "host.default.podman.native",
        "Failed",
        "Bootstrap",
        "attempt: 0",
        "DeterministicBackoff",
        "ApiSocketUnresolved",
    ] {
        assert!(
            rendered.contains(expected),
            "the debug view must mention {expected}: {rendered}"
        );
    }
}

#[tokio::test]
async fn a_pair_that_is_not_a_connector_reports_it_as_the_hosts_own_failure() {
    // An uncomposable connection has to fail with a REASON, and above all must never fall back to a
    // native transport and connect to the LOCAL engine while claiming to be the host that was asked
    // for. It used to be `container.native`, an unported connector; both Apple arms compose now, so
    // the subject is the pair that was never registered at all.
    let mut harness = harness_for(mismatched_pair(), false, false);

    let log = harness.connect(0).await;

    assert!(log.argv.is_empty(), "nothing ran: {:?}", log.argv);
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::HostNotSupported);
    assert_eq!(
        error.params.get("host").and_then(|it| it.as_str()),
        Some("docker.native"),
        "the client renders which host, so the parameters carry it"
    );
    assert_eq!(
        error.params.get("engine").and_then(|it| it.as_str()),
        Some("podman"),
        "and which engine — the host alone names a connector that exists"
    );
    assert_eq!(
        harness.machine.availability().report.api.code,
        DiagnosticCode::HostNotSupported,
        "the real reason is folded into the report rather than left as the placeholder"
    );
    assert!(!harness.machine.availability().host);
}

/// A `podman` engine on a `docker.native` host — registered separately, never together.
///
/// Built inline because [`connection`] derives the engine from the host's own prefix, which is
/// exactly the coupling this test has to break.
fn mismatched_pair() -> Connection {
    serde_json::from_value(json!({
      "id": "host.default.docker.native",
      "name": "Native",
      "label": "Native",
      "engine": "podman",
      "host": "docker.native",
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": "", "relay": "" } },
        "program": { "name": "podman", "path": "", "version": "5.6.2" },
        "rootfull": false,
        "mode": "mode.automatic"
      }
    }))
    .expect("connection fixture parses")
}

#[tokio::test]
async fn a_command_the_host_could_not_spawn_at_all_is_a_failed_outcome_not_a_crash() {
    // `Command.Execute` catches and returns `{ success: false }`, which is why `which podman` on a
    // machine without podman reaches a diagnostic through detection instead of throwing past it.
    let mut harness = Harness::over(
        options(connection("podman.native", "mode.automatic", "", ""), false),
        linux(None),
        FakeCommand::unspawnable(),
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.availability().report.program.code,
        DiagnosticCode::ProgramNotFound,
        "the reason is the domain's diagnostic, not the capability's io error"
    );
    assert_eq!(
        harness.machine.runtime_info().error.map(|it| it.code),
        Some(DiagnosticCode::ProgramNotFound)
    );
}

#[tokio::test]
async fn the_line_that_announces_a_failure_carries_the_reason_with_it() {
    // A client watching the progress stream must not have to go and ask for the state separately:
    // the line that says `failed` is the line that says why, or the two can be read out of order.
    let mut harness = harness_for(podman_at("", "/run/podman.sock"), false, false);

    let log = harness.connect(0).await;

    assert_eq!(
        log.codes().last(),
        Some(&Some(DiagnosticCode::ProgramNotFound)),
        "got {:?}",
        log.codes()
    );
    assert_eq!(
        log.codes().first(),
        Some(&None),
        "and only that line — a sub-step that is merely under way carries no code"
    );
}

#[tokio::test]
async fn a_disconnect_reaches_idle_from_anywhere_and_clears_what_it_found() {
    let mut harness = harness_for(
        podman_at("/usr/bin/podman", "/run/podman.sock"),
        true,
        false,
    );
    harness.connect(0).await;
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);

    let log = harness.disconnect(1).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Idle);
    assert_eq!(harness.machine.starting_step(), None);
    assert_eq!(harness.machine.runtime_info().error, None);
    assert_eq!(
        log.progress.first().map(|line| line.origin),
        Some(Some(ConnectOrigin::Bootstrap)),
        "the line still says what the attempt it ends was started by"
    );
}
