//! The preflight through the machine.
//!
//! A scope probe that fails says only that the scope is not usable. This is what turns that into a
//! CAUSE: the transport is asked WHY, runs the bounded check sequence, and what it finds replaces
//! `SCOPE_NOT_USABLE` as the connection's error.
//!
//! The failure this prevents is a user being told "scope not usable" when the actual answer is "your
//! key is world-readable" or "the host key changed" — one of which is a security event.
//!
//! `ssh_transport.rs` specifies the sequence and its ORDER against the transport directly. What is
//! here is the CONTRACT: that a failed probe reaches the preflight at all, that the preflight's
//! verdict becomes the connection's, and that the probe's own verdict survives when it cannot.

use crate::harness::{
    Harness, engine_is_healthy, linux, linux_offering, options, podman, podman_remote, ssh_scope,
    ssh_scope_keyed,
};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::ssh::preflight::PREFLIGHT_SENTINEL;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectionPhase, ConnectionStartingStep};

/// A remote whose scope probe fails, and whose preflight then answers `respond`.
///
/// The probe and the preflight's reachability check are told apart by their SENTINEL — two different
/// questions, deliberately spelled differently so a caller reading the argv knows which it is.
fn preflighting(identity_file: &str, respond: fn(&[&str]) -> CommandExecutionResult) -> Harness {
    Harness::new(
        options(podman_remote("engine"), false),
        linux_offering(vec![ssh_scope_keyed("engine", identity_file)]),
        respond,
    )
}

/// A remote that is reachable when the preflight asks, and has the engine it was asked about.
fn preflight_finds_nothing(argv: &[&str]) -> CommandExecutionResult {
    if argv == ["ssh", "-V"] {
        return CommandExecutionResult::ok("OpenSSH_9.6p1");
    }
    if argv[0] == "stat" {
        return CommandExecutionResult::ok("600");
    }
    if argv.contains(&PREFLIGHT_SENTINEL) {
        return CommandExecutionResult::ok(PREFLIGHT_SENTINEL);
    }
    if argv.contains(&"info") {
        return CommandExecutionResult::ok("podman ok");
    }
    // The scope probe itself: answers, but does not echo — `StartupStatus::Error`.
    CommandExecutionResult::ok("Welcome to Ubuntu 24.04\n")
}

#[tokio::test]
async fn a_failed_scope_probe_is_explained_rather_than_reported_as_not_usable() {
    let mut harness = preflighting("", |argv| {
        if argv == ["ssh", "-V"] {
            return CommandExecutionResult::ok("OpenSSH_9.6p1");
        }
        if argv.contains(&PREFLIGHT_SENTINEL) {
            return CommandExecutionResult::failed(
                255,
                "ssh: connect to host 192.168.122.5 port 22: No route to host",
            );
        }
        CommandExecutionResult::failed(255, "kex_exchange_identification: Connection reset by peer")
    });

    let log = harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        log.steps(),
        vec![None, Some(ConnectionStartingStep::StartingScope), None],
        "the explanation is the scope's OWN sub-step: a client is shown no `diagnosing` phase, \
         because the phase vocabulary has no such value"
    );
    assert_eq!(
        log.argv.get(1).map(Vec::as_slice),
        Some(["ssh".to_string(), "-V".to_string()].as_slice()),
        "the sequence starts at the client: {:?}",
        log.argv
    );
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(
        error.code,
        DiagnosticCode::SshUnreachable,
        "the cause, not SCOPE_NOT_USABLE"
    );
    assert_eq!(
        error.params.get("reason").and_then(|it| it.as_str()),
        Some("ssh: connect to host 192.168.122.5 port 22: No route to host")
    );
}

#[tokio::test]
async fn a_changed_host_key_reaches_the_user_as_a_changed_host_key() {
    // The case that most justifies this whole sub-step: `SCOPE_NOT_USABLE` for a possible
    // machine-in-the-middle would bury a security event under a generic failure.
    let mut harness = preflighting("", |argv| {
        if argv == ["ssh", "-V"] {
            return CommandExecutionResult::ok("OpenSSH_9.6p1");
        }
        if argv.contains(&PREFLIGHT_SENTINEL) {
            return CommandExecutionResult::failed(
                255,
                "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!",
            );
        }
        CommandExecutionResult::failed(255, "Host key verification failed.")
    });

    harness.connect(0).await;

    assert_eq!(
        harness.machine.runtime_info().error.map(|it| it.code),
        Some(DiagnosticCode::SshHostKeyChanged)
    );
}

#[tokio::test]
async fn a_preflight_that_finds_nothing_wrong_leaves_the_original_verdict_standing() {
    // The link works when asked a second time, so the preflight has no better answer than the one
    // the scope probe already gave. Inventing one would be worse than saying "not usable".
    let mut harness = preflighting("", preflight_finds_nothing);

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.runtime_info().error.map(|it| it.code),
        Some(DiagnosticCode::ScopeNotUsable),
        "the scope's own verdict survives when the preflight cannot improve on it"
    );
}

#[tokio::test]
async fn the_engine_the_settings_name_is_what_the_preflight_asks_the_remote_for() {
    let mut harness = preflighting("", preflight_finds_nothing);

    let log = harness.connect(0).await;

    let engine_check = log
        .argv
        .last()
        .expect("the preflight ran to its last check");
    assert_eq!(
        &engine_check[engine_check.len() - 2..],
        &["podman".to_string(), "info".to_string()],
        "the remote engine check uses settings.program.name: {engine_check:?}"
    );
}

#[tokio::test]
async fn a_remote_engine_that_is_not_installed_is_reported_as_such() {
    let mut harness = preflighting("", |argv| {
        if argv == ["ssh", "-V"] {
            return CommandExecutionResult::ok("OpenSSH_9.6p1");
        }
        if argv.contains(&PREFLIGHT_SENTINEL) {
            return CommandExecutionResult::ok(PREFLIGHT_SENTINEL);
        }
        if argv.contains(&"info") {
            return CommandExecutionResult::failed(127, "bash: podman: command not found");
        }
        CommandExecutionResult::ok("Welcome to Ubuntu 24.04\n")
    });

    harness.connect(0).await;

    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ProgramNotFound);
    assert_eq!(
        error.params.get("host").and_then(|it| it.as_str()),
        Some("192.168.122.5"),
        "naming the host says the program is missing THERE"
    );
}

#[tokio::test]
async fn the_identity_file_is_inspected_when_the_scope_names_one() {
    let mut harness = preflighting("~/.ssh/id_ed25519", preflight_finds_nothing);

    let log = harness.connect(0).await;

    assert!(
        log.argv.contains(&vec![
            "stat".to_string(),
            "-c".to_string(),
            "%a".to_string(),
            format!("{}/.ssh/id_ed25519", crate::harness::HOME),
        ]),
        "the path is expanded against the context's home, not left as `~`: {:?}",
        log.argv
    );
}

#[tokio::test]
async fn a_world_readable_key_is_what_the_user_is_told_about() {
    // `ssh` silently IGNORES a key any other user can read, so the failure it would otherwise
    // produce is an unexplained "permission denied".
    let mut harness = preflighting("~/.ssh/id_ed25519", |argv| {
        if argv == ["ssh", "-V"] {
            return CommandExecutionResult::ok("OpenSSH_9.6p1");
        }
        if argv[0] == "stat" {
            return CommandExecutionResult::ok("644");
        }
        CommandExecutionResult::ok("Welcome to Ubuntu 24.04\n")
    });

    harness.connect(0).await;

    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::SshAuthFailed);
    assert_eq!(
        error.params.get("mode").and_then(|it| it.as_str()),
        Some("644")
    );
}

#[tokio::test]
async fn a_scope_that_was_never_configured_is_not_worth_a_preflight() {
    // `SCOPE_NOT_SET` and `SCOPE_NOT_FOUND` are settings mistakes, decided before any probe runs.
    // There is no link to diagnose, and running `ssh -V` to explain a missing setting would be noise.
    let mut harness = Harness::new(
        options(podman_remote(""), false),
        linux_offering(vec![ssh_scope("engine")]),
        preflight_finds_nothing,
    );

    let log = harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.runtime_info().error.map(|it| it.code),
        Some(DiagnosticCode::ScopeNotSet)
    );
    assert!(
        log.argv.is_empty(),
        "no preflight for a setting that is absent: {:?}",
        log.argv
    );
}

#[tokio::test]
async fn a_native_connection_has_nothing_to_preflight() {
    // Symmetry, as everywhere else in the transport: native answers the question with an absence
    // rather than being exempt from being asked. It has no scope, so it never reaches this at all.
    let mut harness = Harness::new(options(podman(), false), linux(None), engine_is_healthy);

    let log = harness.connect(0).await;

    assert!(
        !log.argv.iter().any(|argv| argv[0] == "ssh"),
        "a native connection never runs ssh: {:?}",
        log.argv
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
}

#[tokio::test]
async fn a_windows_client_has_no_mode_bits_to_inspect() {
    // Windows has ACLs rather than mode bits and no `stat -c` to ask, so the key check is skipped
    // exactly where the original skips it — and the sequence carries on to the link itself.
    let mut harness = Harness::new(
        cdc_runtime::domain::types::connection::ConnectOptions {
            connection: podman_remote("engine"),
            start_api: false,
            skip_availability_check: false,
            origin: None,
        },
        cdc_runtime::domain::machine::ConnectionContext {
            os: OperatingSystem::WindowsNt,
            scopes: vec![ssh_scope_keyed("engine", "C:/Users/tester/.ssh/id_ed25519")],
            ..linux(None)
        },
        preflight_finds_nothing,
    );

    let log = harness.connect(0).await;

    assert!(
        !log.argv.iter().any(|argv| argv[0].starts_with("stat")),
        "no mode bits were asked for: {:?}",
        log.argv
    );
}
