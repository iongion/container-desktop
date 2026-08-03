//! The SSH transport — the argv, the refusals, and the preflight ORDER.
//!
//! The argv IS the observable behaviour, so it is asserted WHOLE and never by its tail. What the
//! inversion changed is only who runs it; the rules are the same, which is why these assertions are.

use crate::fakes::{FakeCommand, unit_host, unit_settings};
mod bridge;
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::argv::SSH_CONNECT_TIMEOUT_SECONDS;
use cdc_runtime::domain::types::connection::{SshHost, SshHostType};
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::host::StartupStatus;
use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::Transport;
use cdc_runtime::runtimes::dialects::container::AppleDialect;
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::profiles::shared::SshProfile;
use cdc_runtime::runtimes::transports::ssh::{SSH_PROBE_SENTINEL, SshTransport};

fn ssh_scope() -> ControllerScope {
    ControllerScope::SshHost(SshHost {
        config_host: None,
        connected: None,
        host: "192.168.122.5".to_string(),
        host_name: "192.168.122.5".to_string(),
        identity_file: "/home/tester/.ssh/id_rsa".to_string(),
        name: "win11".to_string(),
        port: 2222,
        type_: SshHostType::SshConnection,
        usable: None,
        user: "tester".to_string(),
    })
}

fn remote(
    os: OperatingSystem,
    scoped: bool,
    respond: fn(&[&str]) -> CommandExecutionResult,
) -> (
    cdc_runtime::runtimes::host_client::HostClient,
    std::sync::Arc<std::sync::Mutex<crate::fakes::Asked>>,
) {
    let command = FakeCommand::answering(respond);
    let log = command.log();
    let host = unit_host(
        "host.default.podman.remote",
        Box::new(SshTransport),
        Box::new(PodmanDialect),
        Box::new(SshProfile::PODMAN),
        os,
        command,
    );
    (
        if scoped {
            host.with_scope(Some(ssh_scope()))
        } else {
            host
        },
        log,
    )
}

/// The same remote with Apple's engine at the far end — the one dialect that ships no `dial-stdio`.
fn apple_remote(
    respond: fn(&[&str]) -> CommandExecutionResult,
) -> (
    cdc_runtime::runtimes::host_client::HostClient,
    std::sync::Arc<std::sync::Mutex<crate::fakes::Asked>>,
) {
    let command = FakeCommand::answering(respond);
    let log = command.log();
    let host = unit_host(
        "host.default.container.remote",
        Box::new(SshTransport),
        Box::new(AppleDialect),
        Box::new(SshProfile::APPLE),
        OperatingSystem::Darwin,
        command,
    );
    (host.with_scope(Some(ssh_scope())), log)
}

#[test]
fn the_ssh_transport_is_scoped() {
    assert!(SshTransport.is_scoped());
}

#[tokio::test]
async fn a_scope_command_is_the_whole_ssh_invocation() {
    let (host, log) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok("")
    });

    SshTransport
        .run_scope_command(&host, "podman", &["info".to_string()], &unit_settings())
        .await
        .expect("a bound scope accepts a command");

    let asked = log.lock().expect("asked");
    assert_eq!(
        asked.commands[0].timeout,
        Some(cdc_runtime::domain::argv::SSH_COMMAND_TIMEOUT),
        "bounded, so a command cannot outlive the connection attempt carrying it"
    );
    let argv = &asked.argv[0];
    assert_eq!(argv[0], "ssh");
    assert!(argv.contains(&"-p".to_string()) && argv.contains(&"2222".to_string()));
    assert!(argv.contains(&"-i".to_string()));
    assert!(argv.contains(&"tester@192.168.122.5".to_string()));
    assert_eq!(
        &argv[argv.len() - 2..],
        &["podman".to_string(), "info".to_string()],
        "the remote command is the tail, in order"
    );
}

#[tokio::test]
async fn a_probe_that_echoes_means_running_and_anything_else_means_error() {
    // A zero exit alone is NOT evidence: a shell that prints a banner and exits 0 has not proved it
    // can run the command the engine needs. `Running` rather than `Started`, because `ssh` left
    // nothing running — what was found was already up.
    let (echoing, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok(format!("{SSH_PROBE_SENTINEL}\n"))
    });
    assert_eq!(
        SshTransport.start_scope(&echoing).await.expect("probes"),
        StartupStatus::Running
    );

    let (banner, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok("Welcome to Ubuntu\n")
    });
    assert_eq!(
        SshTransport.start_scope(&banner).await.expect("probes"),
        StartupStatus::Error
    );
}

#[tokio::test]
async fn an_unbound_scope_refuses_every_operation_and_names_the_transport() {
    let (host, log) = remote(OperatingSystem::Linux, false, |_| {
        CommandExecutionResult::ok("")
    });

    let refusal = SshTransport
        .run_scope_command(&host, "podman", &["info".to_string()], &unit_settings())
        .await
        .expect_err("no scope, no command");
    assert_eq!(refusal.code, DiagnosticCode::ScopeNotSet);
    assert_eq!(
        refusal
            .params
            .as_ref()
            .and_then(|it| it.get("program"))
            .and_then(serde_json::Value::as_str),
        Some("podman"),
        "the refusal says what would not run"
    );
    assert!(SshTransport.start_scope(&host).await.is_err());
    assert!(
        log.lock().expect("asked").argv.is_empty(),
        "and nothing was attempted locally"
    );
}

#[tokio::test]
async fn a_scope_of_any_other_kind_is_refused_by_the_name_the_schema_gives_it() {
    // A scope resolves by NAME, so a host can hand this transport a machine, a distribution or a
    // Lima instance that happens to be called what the settings named. Each is refused by KIND —
    // reported as the schema's own `ControllerScopeType` rather than a hand-written table of wire
    // names that could drift — and nothing is run, because there is no link to run it over.
    let wrong_kinds = [
        (
            ControllerScope::PodmanMachine(
                serde_json::from_value(serde_json::json!({
                    "Name": "podman-machine-default", "Type": "PodmanMachine", "Active": true,
                    "Created": "now", "LastUp": "now", "Running": true, "Usable": true,
                    "VMType": "qemu"
                }))
                .expect("machine fixture parses"),
            ),
            "PodmanMachine",
        ),
        (
            ControllerScope::LimaInstance(
                serde_json::from_value(serde_json::json!({
                    "Name": "lima-engine", "Type": "LIMAInstance", "Status": "Running",
                    "Dir": "/home/tester/.lima/lima-engine", "Arch": "x86_64", "CPUs": "4",
                    "Memory": "4GiB", "Disk": "100GiB", "SSH": "127.0.0.1:60022"
                }))
                .expect("lima fixture parses"),
            ),
            "LIMAInstance",
        ),
        (
            ControllerScope::WslDistribution(
                serde_json::from_value(serde_json::json!({
                    "Name": "Ubuntu", "Type": "WSLDistribution", "Version": "2",
                    "Default": false, "Current": false, "State": "Running"
                }))
                .expect("wsl fixture parses"),
            ),
            "WSLDistribution",
        ),
    ];

    for (scope, named) in wrong_kinds {
        let (host, log) = remote(OperatingSystem::Linux, false, |_| {
            CommandExecutionResult::ok("")
        });
        let host = host.with_scope(Some(scope));

        let refusal = SshTransport
            .start_scope(&host)
            .await
            .expect_err("an SSH transport cannot enter it");

        assert_eq!(refusal.code, DiagnosticCode::ScopeNotSet);
        assert_eq!(
            refusal
                .params
                .as_ref()
                .and_then(|it| it.get("scope"))
                .and_then(serde_json::Value::as_str),
            Some(named)
        );
        assert!(
            log.lock().expect("asked").argv.is_empty(),
            "and nothing was attempted locally"
        );
    }
}

#[tokio::test]
async fn the_forward_refuses_every_address_it_cannot_bind() {
    // Each refusal names the SETTINGS FIELD that has to change.
    let (host, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok("")
    });

    // `-NL <local>:` forwards to nothing: the socket appears, readiness passes, and every request
    // through it fails separately.
    let mut no_relay = unit_settings();
    no_relay.api.connection.uri = "/tmp/local.sock".to_string();
    let refusal = SshTransport
        .start_api(&host, &no_relay)
        .await
        .expect_err("a forward to nowhere is refused");
    assert_eq!(refusal.code, DiagnosticCode::SshForwardFailed);

    // A named pipe cannot be `ssh -NL` forwarded, at either end. The FAR end is the case that
    // actually occurs: a POSIX client detecting a Windows remote reads a pipe as its relay.
    let mut pipe_relay = unit_settings();
    pipe_relay.api.connection.uri = "/tmp/local.sock".to_string();
    pipe_relay.api.connection.relay = "npipe:////./pipe/dockerDesktopLinuxEngine".to_string();
    let refusal = SshTransport
        .start_api(&host, &pipe_relay)
        .await
        .expect_err("a pipe cannot be forwarded");
    assert_eq!(
        refusal
            .params
            .as_ref()
            .and_then(|it| it.get("relay"))
            .and_then(serde_json::Value::as_str),
        Some("npipe:////./pipe/dockerDesktopLinuxEngine"),
        "and it names the far end, not the near one"
    );

    let mut pipe_local = unit_settings();
    pipe_local.api.connection.uri = r"\\.\pipe\container-desktop".to_string();
    pipe_local.api.connection.relay = "/run/podman.sock".to_string();
    let refusal = SshTransport
        .start_api(&host, &pipe_local)
        .await
        .expect_err("a local pipe cannot be bound by ssh either");
    assert!(
        refusal
            .params
            .as_ref()
            .and_then(|it| it.get("uri"))
            .is_some()
    );
}

#[tokio::test]
async fn a_forward_that_binds_is_spawned_as_a_service_named_for_its_connection() {
    let (host, log) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok("")
    });
    let mut settings = unit_settings();
    settings.api.connection.uri = "/tmp/local.sock".to_string();
    settings.api.connection.relay = "/run/podman.sock".to_string();

    assert!(
        SshTransport
            .start_api(&host, &settings)
            .await
            .expect("both ends are forwardable")
    );

    let asked = log.lock().expect("asked");
    assert_eq!(
        asked.spawned,
        vec!["api:host.default.podman.remote".to_string()],
        "qualified with the connection, so a teardown kills its own forward"
    );
}

#[tokio::test]
async fn stopping_the_api_kills_the_service_this_connection_opened() {
    let (host, log) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok("")
    });

    assert!(
        SshTransport
            .stop_api(&host, &unit_settings())
            .await
            .expect("answers")
    );
    assert_eq!(
        log.lock().expect("asked").killed,
        vec!["api:host.default.podman.remote".to_string()]
    );
}

#[tokio::test]
async fn the_preflight_stops_at_the_first_thing_actually_wrong() {
    // A broken `ssh` is reported as such and the remote is never dialled — the order is what stops a
    // symptom being reported as a cause.
    let (host, log) = remote(OperatingSystem::Linux, true, |argv| {
        if argv == ["ssh", "-V"] {
            return CommandExecutionResult::failed(127, "not found");
        }
        CommandExecutionResult::ok("")
    });

    let fault = SshTransport
        .diagnose_scope(&host, Some("podman"))
        .await
        .expect("a broken client is a cause");

    assert_eq!(fault.code, DiagnosticCode::ProgramNotFound);
    assert_eq!(
        log.lock().expect("asked").argv.len(),
        1,
        "nothing after the version probe ran"
    );
}

#[tokio::test]
async fn a_link_that_works_but_has_no_engine_names_the_remote() {
    // The host is named because that is what says the program is missing THERE rather than here.
    let (host, _) = remote(OperatingSystem::Linux, true, |argv| {
        if argv == ["ssh", "-V"] {
            return CommandExecutionResult::ok("OpenSSH_9.6p1");
        }
        if argv[0] == "stat" {
            return CommandExecutionResult::ok("600");
        }
        if argv.iter().any(|it| it.contains("preflight")) {
            return CommandExecutionResult::ok("container-desktop-ssh-preflight-ok\n");
        }
        CommandExecutionResult::failed(127, "podman: command not found")
    });

    let fault = SshTransport
        .diagnose_scope(&host, Some("podman"))
        .await
        .expect("a reachable host with no engine is a cause");

    assert_eq!(fault.code, DiagnosticCode::ProgramNotFound);
    assert_eq!(
        fault
            .params
            .as_ref()
            .and_then(|it| it.get("host"))
            .and_then(serde_json::Value::as_str),
        Some("192.168.122.5")
    );
}

#[tokio::test]
async fn a_healthy_link_with_no_engine_asked_about_finds_nothing_wrong() {
    // `None` is a real answer and a different one from any code: inventing a cause would be worse
    // than the generic verdict the caller already has.
    let (host, _) = remote(OperatingSystem::Linux, true, |argv| {
        if argv == ["ssh", "-V"] {
            return CommandExecutionResult::ok("OpenSSH_9.6p1");
        }
        if argv[0] == "stat" {
            return CommandExecutionResult::ok("600");
        }
        CommandExecutionResult::ok("container-desktop-ssh-preflight-ok\n")
    });

    assert!(SshTransport.diagnose_scope(&host, None).await.is_none());
}

#[tokio::test]
async fn an_unbound_scope_has_no_preflight_to_run() {
    // The probe that just failed could not have run either, so the refusal already produced is the
    // whole story and a preflight would add a second, vaguer one.
    let (host, _) = remote(OperatingSystem::Linux, false, |_| {
        CommandExecutionResult::ok("")
    });

    assert!(
        SshTransport
            .diagnose_scope(&host, Some("podman"))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn only_windows_has_a_local_address_to_impose() {
    // The relay serves a NAMED PIPE there and a client cannot reach the engine any other way, so the
    // transport's answer outranks the settings. POSIX has no opinion: the socket it would bind is a
    // FALLBACK, and answering here instead would overwrite an address the user preset.
    let (windows, _) = remote(OperatingSystem::WindowsNt, true, |_| {
        CommandExecutionResult::ok("")
    });
    assert_eq!(
        SshTransport
            .resolve_scope_uri(&windows, &unit_settings(), "")
            .await,
        cdc_runtime::domain::ssh::forward::windows_pipe_path("host.default.podman.remote"),
        "the pipe is named for the CONNECTION, so two remotes do not fight over one"
    );

    let (posix, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok("")
    });
    assert_eq!(
        SshTransport
            .resolve_scope_uri(&posix, &unit_settings(), "")
            .await,
        ""
    );
}

#[tokio::test]
async fn a_remote_filesystem_path_is_not_translated() {
    let (host, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok("")
    });

    assert_eq!(
        SshTransport.resolve_guest_path(&host, "/tmp/context").await,
        "/tmp/context"
    );
    assert!(
        SshTransport.should_keep_started_scope_running(),
        "a remote host this app connected to is not this app's to shut down"
    );
}

#[tokio::test]
async fn listing_scopes_is_the_callers_job_not_the_transports() {
    // Enumerating SSH hosts means reading `~/.ssh/config`, which the runtime cannot do — the same
    // reason the resolved scope arrives as a value rather than a name.
    let (host, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok("")
    });

    assert!(
        SshTransport
            .list_scopes(&host, &unit_settings())
            .await
            .expect("answers")
            .is_empty()
    );
    assert!(
        SshTransport
            .controller_default_scope(&host, &unit_settings())
            .await
            .expect("answers")
            .is_none()
    );
    assert!(!SshTransport.stop_scope(&host).await.expect("answers"));
}

/// What `podman system connection list --format json` reports on a remote host running a machine.
/// Podman marks the ROOTFUL connection `Default` and this app targets rootless.
const MACHINE_CONNECTIONS: &str = r#"[
  {"Name":"podman-machine-default","URI":"ssh://core@127.0.0.1:56515/run/user/1000/podman/podman.sock",
   "Identity":"/home/tester/.local/share/containers/podman/machine/machine","IsMachine":true,"Default":false},
  {"Name":"podman-machine-default-root","URI":"ssh://root@127.0.0.1:56515/run/podman/podman.sock",
   "Identity":"/home/tester/.local/share/containers/podman/machine/machine","IsMachine":true,"Default":true}
]"#;
