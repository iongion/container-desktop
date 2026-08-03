//! The podman-machine transport — `runtimes/transports/podman-machine.ts`.
//!
//! Podman-only, and the scope is a MACHINE. What is asserted here is the argv every operation runs, the
//! THREE-source address resolution (podman's own pipe, the home socket, the inspect refinement), and
//! the one rule that outranks all of them: an in-VM unix socket never overwrites a Windows pipe.

mod scopes;

use std::sync::{Arc, Mutex};

use crate::fakes::APP_VERSION;
use crate::fakes::{
    Asked, FakeCommand, MemoryFs, unit_host_controlled, unit_host_over, unit_settings,
};
use cdc_runtime::capabilities::command::{CommandExecutionResult, ReadinessCheck};
use cdc_runtime::capabilities::http::Endpoint;
use cdc_runtime::domain::ssh::forward::{windows_named_pipe_path, windows_pipe_path};
use cdc_runtime::domain::types::connection::EngineConnectorSettings;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::Controller;
use cdc_runtime::domain::types::host::StartupStatus;
use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{HostContext, Transport};
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::profiles::podman::PodmanVendorProfile;
use cdc_runtime::runtimes::transports::native::{API_READINESS_ATTEMPTS, API_READINESS_WAIT};
use cdc_runtime::runtimes::transports::podman_machine::{
    PodmanMachineTransport, machine_address, machine_is_running, machine_name,
};

const CONNECTION: &str = "host.default.podman.vendor";
const PODMAN: &str = "/usr/bin/podman";

/// A machine as `podman machine list --format json` reports one, once normalized.
fn machine(name: &str, running: bool) -> ControllerScope {
    ControllerScope::PodmanMachine(
        serde_json::from_value(serde_json::json!({
            "Name": name,
            "Type": "PodmanMachine",
            "Active": true,
            "Created": "c",
            "LastUp": "l",
            "Running": running,
            "Usable": running,
            "VMType": "qemu",
        }))
        .expect("machine fixture parses"),
    )
}

/// Settings a vendor connection carries: the controller IS podman, and the machine is named.
fn vendor_settings(scope: &str) -> EngineConnectorSettings {
    let mut settings = unit_settings();
    settings.controller = Some(Controller {
        auto: None,
        homepage: None,
        name: "podman".to_string(),
        path: PODMAN.to_string(),
        scope: (!scope.is_empty()).then(|| scope.to_string()),
        title: None,
        version: None,
    });
    settings
}

async fn vendor(
    os: OperatingSystem,
    scope: Option<ControllerScope>,
    respond: fn(&[&str]) -> CommandExecutionResult,
) -> (
    cdc_runtime::runtimes::host_client::HostClient,
    Arc<Mutex<Asked>>,
) {
    let command = FakeCommand::answering(respond);
    let log = command.log();
    let host = unit_host_controlled(
        CONNECTION,
        Box::new(PodmanMachineTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanVendorProfile),
        os,
        command,
        "podman",
    )
    .with_scope(scope);
    host.set_settings(vendor_settings("podman-machine-default"))
        .await;
    (host, log)
}

fn default_machine() -> Option<ControllerScope> {
    Some(machine("podman-machine-default", true))
}

#[test]
fn a_machine_this_app_started_is_left_running_because_starting_one_is_slow() {
    assert!(PodmanMachineTransport.is_scoped());
    assert!(
        PodmanMachineTransport.should_keep_started_scope_running(),
        "the opposite of a WSL distribution's answer, and the original's stated reason"
    );
    assert!(
        !PodmanMachineTransport.opens_data_plane(),
        "`start_api` starts the MACHINE, which is the engine's own service by another name"
    );
}

#[tokio::test]
async fn a_scope_command_nests_ssh_into_the_machine_with_podmans_own_logging_silenced() {
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |_| {
        CommandExecutionResult::ok("")
    })
    .await;

    PodmanMachineTransport
        .run_scope_command(
            &host,
            "podman",
            &["info".to_string()],
            &vendor_settings("podman-machine-default"),
        )
        .await
        .expect("a bound machine accepts a command");

    assert_eq!(
        log.lock().expect("asked").argv[0],
        vec![
            PODMAN,
            "machine",
            "ssh",
            "podman-machine-default",
            "-o",
            "LogLevel=ERROR",
            "podman",
            "info"
        ],
        "`LogLevel=ERROR` keeps the nested ssh's notices out of the output the caller parses"
    );
}

#[tokio::test]
async fn a_scope_of_any_other_kind_is_refused_by_the_name_the_schema_gives_it() {
    for (scope, named) in [
        (
            ControllerScope::WslDistribution(
                serde_json::from_value(serde_json::json!({
                    "Name": "podman-machine-default", "Type": "WSLDistribution", "Version": "2",
                    "Default": true, "Current": false, "State": "Running"
                }))
                .expect("wsl fixture parses"),
            ),
            "WSLDistribution",
        ),
        (
            ControllerScope::SshHost(
                serde_json::from_value(serde_json::json!({
                    "Name": "podman-machine-default", "Type": "SSHConnection", "Host": "h",
                    "HostName": "h", "IdentityFile": "/home/tester/.ssh/id_rsa", "Port": 22,
                    "User": "core"
                }))
                .expect("ssh fixture parses"),
            ),
            "SSHConnection",
        ),
        (
            // The fourth kind. A scope arrives by NAME, so a settings file naming
            // `podman-machine-default` can hand this transport a LIMA instance that happens to be
            // called that — and the refusal has to name what it was actually given.
            ControllerScope::LimaInstance(
                serde_json::from_value(serde_json::json!({
                    "Name": "podman-machine-default", "Type": "LIMAInstance", "Status": "Running",
                    "SSH": "60022", "Arch": "aarch64", "CPUs": "4", "Memory": "4GiB",
                    "Disk": "100GiB", "Dir": "/Users/tester/.lima/podman-machine-default"
                }))
                .expect("lima fixture parses"),
            ),
            "LIMAInstance",
        ),
    ] {
        let (host, log) = vendor(OperatingSystem::Linux, Some(scope), |_| {
            CommandExecutionResult::ok("")
        })
        .await;

        let refusal = PodmanMachineTransport
            .stop_scope(&host)
            .await
            .expect_err("a machine transport cannot enter it");
        assert_eq!(refusal.code, DiagnosticCode::ScopeNotSet);
        assert_eq!(
            refusal.params,
            Some(serde_json::json!({ "transport": "podman-machine", "scope": named }))
        );
        assert!(log.lock().expect("asked").argv.is_empty());
    }

    let (unbound, _) = vendor(OperatingSystem::Linux, None, |_| {
        CommandExecutionResult::ok("")
    })
    .await;
    let refusal = PodmanMachineTransport
        .run_scope_command(&unbound, "podman", &[], &vendor_settings(""))
        .await
        .expect_err("no machine, no command");
    assert_eq!(
        refusal.params,
        Some(serde_json::json!({ "transport": "podman-machine", "program": "podman" }))
    );
}

#[tokio::test]
async fn a_machine_that_is_already_running_is_not_started_again() {
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"inspect") {
            return CommandExecutionResult::ok(
                r#"[{"Name":"podman-machine-default","State":"running"}]"#,
            );
        }
        CommandExecutionResult::ok("")
    })
    .await;

    assert_eq!(
        PodmanMachineTransport
            .start_scope(&host)
            .await
            .expect("answers"),
        StartupStatus::Running
    );
    let asked = log.lock().expect("asked");
    assert_eq!(
        asked.argv,
        vec![vec![
            PODMAN.to_string(),
            "machine".to_string(),
            "inspect".to_string(),
            "podman-machine-default".to_string()
        ]],
        "the inspect is the whole cost, and nothing was started"
    );
}

#[tokio::test]
async fn a_stopped_machine_is_started_and_a_machine_that_will_not_start_is_an_error() {
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"inspect") {
            return CommandExecutionResult::ok(
                r#"[{"Name":"podman-machine-default","State":"stopped"}]"#,
            );
        }
        CommandExecutionResult::ok("Machine started successfully")
    })
    .await;

    assert_eq!(
        PodmanMachineTransport
            .start_scope(&host)
            .await
            .expect("answers"),
        StartupStatus::Started
    );
    assert_eq!(
        log.lock().expect("asked").argv[1],
        vec![PODMAN, "machine", "start", "podman-machine-default"]
    );

    let (refusing, _) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"start") {
            return CommandExecutionResult::failed(125, "VM already running or starting");
        }
        CommandExecutionResult::ok(r#"[{"Name":"podman-machine-default","State":"stopped"}]"#)
    })
    .await;
    assert_eq!(
        PodmanMachineTransport
            .start_scope(&refusing)
            .await
            .expect("answers"),
        StartupStatus::Error
    );
}

#[tokio::test]
async fn a_machine_that_cannot_be_inspected_is_started_anyway() {
    // The original logs the failed inspect and carries on: podman itself refuses to start a machine
    // that is already up, and guessing "it must be running" here would skip a start that was needed.
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"inspect") {
            return CommandExecutionResult::failed(125, "no such machine");
        }
        CommandExecutionResult::ok("")
    })
    .await;

    assert_eq!(
        PodmanMachineTransport
            .start_scope(&host)
            .await
            .expect("answers"),
        StartupStatus::Started
    );
    assert_eq!(log.lock().expect("asked").argv.len(), 2);
}

#[test]
fn the_inspect_output_answers_both_questions_and_neither_on_nonsense() {
    let running = r#"[{"Name":"m","State":"running"}]"#;
    assert!(machine_is_running(running, "m"));
    assert!(
        !machine_is_running(running, "other"),
        "the machine is found BY NAME — inspect can be handed more than one"
    );
    assert!(!machine_is_running(
        r#"[{"Name":"m","State":"stopped"}]"#,
        "m"
    ));
    assert!(!machine_is_running("not json", "m"));
    assert!(!machine_is_running("[]", "m"));
}

#[test]
fn an_in_vm_socket_never_overwrites_an_address_that_is_already_a_pipe() {
    // The bug the original's comment records: `PodmanSocket.Path` is not reachable from a native
    // Windows process, and clobbering a resolved pipe with it is what left podman "not reachable".
    let both = r#"[{"Name":"m","ConnectionInfo":{"PodmanPipe":{"Path":"\\\\.\\pipe\\podman-machine-default"},"PodmanSocket":{"Path":"/run/user/1000/podman/podman.sock"}}}]"#;
    assert_eq!(
        machine_address(both, "m", "/tmp/resolved.sock"),
        r"\\.\pipe\podman-machine-default",
        "a pipe the machine reports wins outright"
    );

    let socket_only = r#"[{"Name":"m","ConnectionInfo":{"PodmanSocket":{"Path":"/run/user/1000/podman/podman.sock"}}}]"#;
    assert_eq!(
        machine_address(
            socket_only,
            "m",
            &windows_named_pipe_path("podman-machine-default")
        ),
        windows_named_pipe_path("podman-machine-default"),
        "and an already-resolved pipe survives an inspect that reports only the in-VM socket"
    );
    assert_eq!(
        machine_address(socket_only, "m", "/tmp/resolved.sock"),
        "/run/user/1000/podman/podman.sock",
        "where nothing is a pipe, the machine's own socket is better than the one guessed from home"
    );

    // Nothing usable in the output leaves what was already resolved alone — three ways.
    for output in [
        "not json",
        "[]",
        r#"[{"Name":"other","ConnectionInfo":{"PodmanSocket":{"Path":"/x.sock"}}}]"#,
        r#"[{"Name":"m","ConnectionInfo":{}}]"#,
    ] {
        assert_eq!(
            machine_address(output, "m", "/tmp/resolved.sock"),
            "/tmp/resolved.sock",
            "{output}"
        );
    }
}

#[tokio::test]
async fn on_windows_podmans_own_pipe_is_preferred_over_the_apps_relay() {
    let (host, _) = vendor(OperatingSystem::WindowsNt, default_machine(), |argv| {
        if argv.contains(&"connection") {
            return CommandExecutionResult::ok(
                r#"[{"Name":"podman-machine-default","IsMachine":true,"Default":true,"URI":"npipe:////./pipe/podman-machine-default"}]"#,
            );
        }
        CommandExecutionResult::failed(1, "no inspect")
    })
    .await;

    assert_eq!(
        PodmanMachineTransport
            .resolve_scope_uri(&host, &vendor_settings("podman-machine-default"), "")
            .await,
        windows_named_pipe_path("podman-machine-default"),
        "dialable directly — no relay, no bridge, no `dial-stdio`"
    );

    // An older WSL-ssh machine lists no pipe, so the app's own relay pipe is what a client dials and
    // a bridge has to serve it.
    let (older, _) = vendor(OperatingSystem::WindowsNt, default_machine(), |_| {
        CommandExecutionResult::ok("[]")
    })
    .await;
    assert_eq!(
        PodmanMachineTransport
            .resolve_scope_uri(&older, &vendor_settings("podman-machine-default"), "")
            .await,
        windows_pipe_path("podman-machine-default"),
        "keyed by the MACHINE, because every connection naming it reaches the same engine"
    );
}

#[tokio::test]
async fn on_posix_the_machines_own_socket_is_preferred_over_podmans_shared_one() {
    // Both live under the home directory. The per-machine one is used only when it is actually there,
    // which is what the original probes for — and a machine that has none is reached on the shared one.
    let (host, _) = vendor(OperatingSystem::Linux, default_machine(), |_| {
        CommandExecutionResult::failed(1, "no inspect")
    })
    .await;

    assert_eq!(
        PodmanMachineTransport
            .resolve_scope_uri(&host, &vendor_settings("podman-machine-default"), "")
            .await,
        "/home/tester/.local/share/containers/podman/machine/podman.sock",
        "the fake filesystem has no per-machine socket, so the shared one answers"
    );

    assert_eq!(
        PodmanMachineTransport
            .resolve_scope_uri(&host, &vendor_settings(""), "")
            .await,
        "/home/tester/.local/share/containers/podman/machine/podman.sock",
        "and with no machine named there is nothing to inspect either"
    );
}

#[tokio::test]
async fn a_machine_that_has_its_own_socket_is_reached_on_that_one() {
    // The other side of the branch above, which its own comment names and no fixture reached: when
    // the per-machine socket IS on disk, it wins over the shared one. Podman writes it per machine,
    // so on a host with two machines the shared path is whichever was started last — reaching a
    // machine on it is reaching whatever else is running.
    let per_machine =
        "/home/tester/.local/share/containers/podman/machine/podman-machine-default/podman.sock";
    let command = FakeCommand::answering(|_| CommandExecutionResult::failed(1, "no inspect"));
    let host = unit_host_over(
        CONNECTION,
        Box::new(PodmanMachineTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanVendorProfile),
        OperatingSystem::Linux,
        command,
        "podman",
        MemoryFs::seeded(per_machine, ""),
    )
    .with_scope(default_machine());
    host.set_settings(vendor_settings("podman-machine-default"))
        .await;

    assert_eq!(
        PodmanMachineTransport
            .resolve_scope_uri(&host, &vendor_settings("podman-machine-default"), "")
            .await,
        per_machine
    );
}

#[tokio::test]
async fn the_inspect_refines_whatever_the_platform_resolved() {
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"inspect") {
            return CommandExecutionResult::ok(
                r#"[{"Name":"podman-machine-default","ConnectionInfo":{"PodmanSocket":{"Path":"/home/tester/.local/share/containers/podman/machine/qemu/podman.sock"}}}]"#,
            );
        }
        CommandExecutionResult::ok("[]")
    })
    .await;

    assert_eq!(
        PodmanMachineTransport
            .resolve_scope_uri(&host, &vendor_settings("podman-machine-default"), "")
            .await,
        "/home/tester/.local/share/containers/podman/machine/qemu/podman.sock"
    );
    assert_eq!(
        log.lock().expect("asked").argv.last().expect("an inspect"),
        &vec![
            PODMAN.to_string(),
            "machine".to_string(),
            "inspect".to_string(),
            "podman-machine-default".to_string()
        ]
    );
}

#[tokio::test]
async fn starting_the_api_starts_the_machine_and_waits_for_the_address_it_exposes() {
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |_| {
        CommandExecutionResult::ok("")
    })
    .await;
    let mut settings = vendor_settings("podman-machine-default");
    settings.api.connection.uri =
        "unix:///home/tester/.local/share/containers/podman/machine/podman.sock".to_string();

    assert!(
        PodmanMachineTransport
            .start_api(&host, &settings)
            .await
            .expect("the machine starts")
    );

    let asked = log.lock().expect("asked");
    let (id, command, opts) = &asked.services[0];
    assert_eq!(id.0, "api:host.default.podman.vendor");
    assert_eq!(
        command.argv(),
        vec![PODMAN, "machine", "start", "podman-machine-default"]
    );
    assert_eq!(opts.retry.count, API_READINESS_ATTEMPTS);
    assert_eq!(opts.retry.wait, API_READINESS_WAIT);
    assert_eq!(
        opts.check_status,
        ReadinessCheck::ApiAnswers {
            endpoint: Endpoint::UnixSocket(
                "/home/tester/.local/share/containers/podman/machine/podman.sock".to_string()
            ),
            headers: vec![
                ("Host".to_string(), "d".to_string()),
                ("Accept".to_string(), "application/json".to_string()),
                ("Content-Type".to_string(), "application/json".to_string()),
                (
                    "User-Agent".to_string(),
                    format!("Container Desktop {APP_VERSION}"),
                ),
            ],
        },
        "what a machine exposes IS local — a socket under the home directory, or a pipe — so a \
         request down it reaches the engine, unlike a service inside a distribution"
    );
}

#[tokio::test]
async fn a_machine_that_will_not_start_is_forgiven_and_an_unresolved_address_is_not() {
    let refusing = unit_host_controlled(
        CONNECTION,
        Box::new(PodmanMachineTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanVendorProfile),
        OperatingSystem::Linux,
        FakeCommand::agreeable().refusing_services(),
        "podman",
    )
    .with_scope(default_machine());
    let mut settings = vendor_settings("podman-machine-default");
    settings.api.connection.uri = "/run/podman.sock".to_string();

    assert!(
        !PodmanMachineTransport
            .start_api(&refusing, &settings)
            .await
            .expect("a machine that will not start is an answer, not an error"),
        "something outside this app may have started it, and the availability check decides"
    );

    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |_| {
        CommandExecutionResult::ok("")
    })
    .await;
    let refusal = PodmanMachineTransport
        .start_api(&host, &vendor_settings("podman-machine-default"))
        .await
        .expect_err("an address nothing resolved is refused");
    assert_eq!(refusal.code, DiagnosticCode::ApiSocketUnresolved);
    assert!(log.lock().expect("asked").services.is_empty());
}

#[tokio::test]
async fn stopping_the_api_kills_the_service_and_leaves_the_machine_alone() {
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |_| {
        CommandExecutionResult::ok("")
    })
    .await;

    assert!(
        PodmanMachineTransport
            .stop_api(&host, &vendor_settings("podman-machine-default"))
            .await
            .expect("answers")
    );
    let asked = log.lock().expect("asked");
    assert_eq!(
        asked.killed,
        vec!["api:host.default.podman.vendor".to_string()]
    );
    assert!(
        asked.argv.is_empty(),
        "no `machine stop` — a machine takes minutes to come back, so it is left running"
    );
}

#[tokio::test]
async fn stopping_the_scope_is_the_one_thing_that_does_stop_the_machine() {
    // `stop_scope` is the deliberate request, and it is not what a teardown calls.
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |_| {
        CommandExecutionResult::ok("")
    })
    .await;

    assert!(
        PodmanMachineTransport
            .stop_scope(&host)
            .await
            .expect("answers")
    );
    assert_eq!(
        log.lock().expect("asked").argv[0],
        vec![PODMAN, "machine", "stop", "podman-machine-default"]
    );
}

#[tokio::test]
async fn a_machine_mounts_the_home_directory_at_the_same_path() {
    let (host, _) = vendor(OperatingSystem::Linux, default_machine(), |_| {
        CommandExecutionResult::ok("")
    })
    .await;

    assert_eq!(
        PodmanMachineTransport
            .resolve_guest_path(&host, "/home/tester/ctx")
            .await,
        "/home/tester/ctx"
    );
    assert_eq!(
        PodmanMachineTransport.local_forward_fallback(&host).await,
        "",
        "nothing is forwarded to a machine: the address it exposes is already local"
    );
    assert!(
        PodmanMachineTransport
            .diagnose_scope(&host, Some("podman"))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn the_launcher_falls_back_to_the_registered_controller_when_nothing_is_configured() {
    // The original's `controllerPath || host.CONTROLLER`: an undetected controller is still worth
    // trying BY NAME, because it may be on the PATH — and an empty launcher fails with `ENOENT ''`,
    // which names nothing at all.
    let mut settings = vendor_settings("podman-machine-default");
    settings.controller = None;
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |_| {
        CommandExecutionResult::ok("")
    })
    .await;

    PodmanMachineTransport
        .stop_scope(&host)
        .await
        .expect("answers");
    assert_eq!(
        log.lock().expect("asked").argv[0][0],
        PODMAN,
        "the machine's own settings are what `stop_scope` reads"
    );

    let listed = PodmanMachineTransport
        .list_scopes(&host, &settings)
        .await
        .expect("answers");
    assert!(listed.is_empty());
    assert_eq!(
        log.lock().expect("asked").argv[1][0],
        "podman",
        "and with no controller configured, the name the connector registered is what runs"
    );
}

#[test]
fn a_machine_name_is_only_read_from_a_machine_scope() {
    // The mirror of the Lima rule, and the reason the doc on this function was corrected: it answers
    // for a podman machine and for nothing else. Selection matches a NAME against the scopes a host
    // offers, so a `None` here means "not mine" — a WSL distribution called `podman-machine-default`
    // is a real thing, and reading its name as a machine's is how a transport enters the wrong guest.
    assert_eq!(
        machine_name(&machine("podman-machine-default", true)),
        Some("podman-machine-default".to_string())
    );
    assert_eq!(
        machine_name(&ControllerScope::WslDistribution(
            serde_json::from_value(serde_json::json!({
                "Name": "podman-machine-default", "Type": "WSLDistribution", "Version": "2",
                "Default": true, "Current": false, "State": "Running"
            }))
            .expect("wsl fixture parses"),
        )),
        None,
        "a distribution that shares the name is still not a machine"
    );
}
