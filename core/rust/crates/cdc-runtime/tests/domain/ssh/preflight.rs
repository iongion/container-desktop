//! Why an SSH connection probe failed.
//!
//! Two halves, and they fail apart: the pure VERDICT rules — which turn one command's output into a
//! cause — and the ORDER the four checks run in, which is what stops a symptom being reported as a
//! cause. The rules need no host; the order is driven through the transport in `ssh_transport.rs`.

use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::argv::SSH_COMMAND_TIMEOUT;
use cdc_runtime::domain::ssh::args::SshCredentials;
use cdc_runtime::domain::ssh::preflight::{PREFLIGHT_SENTINEL, SSH_VERSION_TIMEOUT, SshPreflight};
use cdc_runtime::domain::types::connection::{SshHost, SshHostType};
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::os::OperatingSystem;

fn scope(identity: &str) -> SshHost {
    SshHost {
        config_host: None,
        connected: None,
        host: "win11".to_string(),
        host_name: "192.168.122.5".to_string(),
        identity_file: identity.to_string(),
        name: "win11".to_string(),
        port: 22,
        type_: SshHostType::SshConnection,
        usable: None,
        user: "tester".to_string(),
    }
}

fn preflight(identity: &str, os: OperatingSystem) -> SshPreflight {
    SshPreflight::new(
        SshCredentials::from_scope(&scope(identity), "/home/tester"),
        os,
    )
}

#[test]
fn the_version_probe_is_bounded_short() {
    // A broken client must not cost a full connect timeout to discover. A diagnostic that hangs is
    // worse than the hang it was written to explain.
    let command = preflight("/home/tester/.ssh/id_rsa", OperatingSystem::Linux).version_command();

    assert_eq!(command.argv(), vec!["ssh", "-V"]);
    assert_eq!(command.timeout, Some(SSH_VERSION_TIMEOUT));
    assert!(
        SSH_VERSION_TIMEOUT < SSH_COMMAND_TIMEOUT,
        "and it is shorter than a connect"
    );
}

#[test]
fn the_identity_check_is_skipped_where_it_cannot_be_answered() {
    // No identity file is VALID and common: OpenSSH falls back to `ssh_config` defaults, the agent
    // and standard discovery. Windows has ACLs rather than mode bits and no `stat -c` to ask.
    assert!(
        preflight("", OperatingSystem::Linux)
            .identity_command()
            .is_none()
    );
    assert!(
        preflight("/home/tester/.ssh/id_rsa", OperatingSystem::WindowsNt)
            .identity_command()
            .is_none()
    );

    let command = preflight("/home/tester/.ssh/id_rsa", OperatingSystem::Linux)
        .identity_command()
        .expect("a POSIX client with a key can be asked");
    assert_eq!(
        command.argv(),
        vec!["stat", "-c", "%a", "/home/tester/.ssh/id_rsa"]
    );
    assert_eq!(
        command.timeout,
        Some(SSH_VERSION_TIMEOUT),
        "a local check that has not answered in five seconds is broken rather than slow — and an \
         unbounded one would hang the very diagnostic written to explain a hang"
    );
}

#[test]
fn a_key_anyone_else_can_read_is_a_fault_and_names_the_mode() {
    // `ssh` silently IGNORES such a key, so the failure it would otherwise produce is an unexplained
    // "permission denied". Only the last two octal digits matter — the owner's bits are their own
    // business.
    let preflight = preflight("/home/tester/.ssh/id_rsa", OperatingSystem::Linux);

    for mode in ["644", "640", "604", "0"] {
        let fault = preflight
            .identity_fault(&CommandExecutionResult::ok(mode))
            .expect("a readable key is refused");
        assert_eq!(fault.code, DiagnosticCode::SshAuthFailed);
        assert_eq!(
            fault
                .params
                .as_ref()
                .and_then(|it| it.get("mode"))
                .and_then(serde_json::Value::as_str),
            Some(mode),
            "the mode travels so a client can say which one"
        );
    }
    for mode in ["600", "400", "700"] {
        assert!(
            preflight
                .identity_fault(&CommandExecutionResult::ok(mode))
                .is_none(),
            "{mode} is private enough"
        );
    }
}

#[test]
fn a_key_that_cannot_be_stat_ed_at_all_is_the_same_code_with_no_mode() {
    // Both end the same way — `ssh` authenticating without the key the user configured — and the
    // PARAMS say which it was.
    let fault = preflight("/home/tester/.ssh/id_rsa", OperatingSystem::Linux)
        .identity_fault(&CommandExecutionResult::failed(1, "No such file"))
        .expect("a missing key is refused");

    assert_eq!(fault.code, DiagnosticCode::SshAuthFailed);
    assert!(
        fault
            .params
            .as_ref()
            .and_then(|it| it.get("mode"))
            .is_none()
    );
}

#[test]
fn a_changed_host_key_outranks_the_generic_verification_failure() {
    // ORDER matters: a changed host key ALSO prints "Host key verification failed", and reporting
    // that as unreachable would send someone to check their network when the fix is `known_hosts`.
    let preflight = preflight("", OperatingSystem::Linux);

    for stderr in [
        "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@",
        "Host key verification failed.",
    ] {
        assert_eq!(
            preflight
                .probe_fault(&CommandExecutionResult::failed(255, stderr))
                .code,
            DiagnosticCode::SshHostKeyChanged
        );
    }
}

#[test]
fn the_authentication_failures_openssh_actually_prints_are_recognised() {
    let preflight = preflight("", OperatingSystem::Linux);

    for stderr in [
        "tester@host: Permission denied (publickey).",
        "Received disconnect: Too many authentication failures",
        "No such identity: /home/tester/.ssh/id_rsa",
    ] {
        let fault = preflight.probe_fault(&CommandExecutionResult::failed(255, stderr));
        assert_eq!(fault.code, DiagnosticCode::SshAuthFailed, "{stderr}");
        assert_eq!(
            fault
                .params
                .as_ref()
                .and_then(|it| it.get("user"))
                .and_then(serde_json::Value::as_str),
            Some("tester"),
            "the diagnostic names WHO was refused — the fix is usually a different account"
        );
    }
}

#[test]
fn anything_else_is_unreachable_and_carries_the_first_real_line() {
    // Refused, timed out and unresolvable are all "unreachable", and the difference between them is
    // the entire actionable content — so the reason travels.
    let fault = preflight("", OperatingSystem::Linux).probe_fault(&CommandExecutionResult::failed(
        255,
        "\n\n  ssh: connect to host 192.168.122.5 port 22: Connection refused\nmore noise\n",
    ));

    assert_eq!(fault.code, DiagnosticCode::SshUnreachable);
    let params = fault.params.expect("the reason travels");
    assert_eq!(
        params.get("reason").and_then(serde_json::Value::as_str),
        Some("ssh: connect to host 192.168.122.5 port 22: Connection refused"),
        "the first NON-EMPTY line, trimmed — not the blank one above it"
    );
    assert_eq!(
        params.get("port").and_then(serde_json::Value::as_i64),
        Some(22)
    );
}

#[test]
fn a_host_that_exits_zero_without_echoing_has_not_proved_anything() {
    // A shell that prints a banner and exits 0 has not shown it can run what the engine needs.
    assert!(SshPreflight::echoed(&CommandExecutionResult::ok(format!(
        "{PREFLIGHT_SENTINEL}\n"
    ))));
    assert!(!SshPreflight::echoed(&CommandExecutionResult::ok(
        "Welcome to Ubuntu\n"
    )));
    assert!(!SshPreflight::echoed(&CommandExecutionResult::failed(
        1,
        PREFLIGHT_SENTINEL
    )));
}

#[test]
fn the_remote_probes_are_bounded_and_carry_the_credentials() {
    let preflight = preflight("", OperatingSystem::Linux);

    let reachable = preflight.reachable_command();
    assert_eq!(reachable.launcher, "ssh");
    assert_eq!(reachable.timeout, Some(SSH_COMMAND_TIMEOUT));
    assert!(reachable.args.iter().any(|it| it == PREFLIGHT_SENTINEL));

    let engine = preflight.engine_command("podman");
    assert_eq!(engine.args.last().map(String::as_str), Some("info"));
}
