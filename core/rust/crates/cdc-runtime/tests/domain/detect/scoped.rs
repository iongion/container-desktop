//! Detection through a SCOPE — the same sequence, with every command wrapped by the transport.
//!
//! The wrapping is one place (`HostContext::run_probe`) and it branches on the transport's
//! CAPABILITY, never on the host type. What is asserted here is that a scoped host asks the REMOTE
//! about the ENGINE and never the local machine, which is the failure mode that would otherwise
//! report this laptop's engine as the remote's.
//!
//! The CONTROLLER is the exception, and it is the whole reason the scoped branch exists: `wsl`,
//! `limactl`, `podman` and `ssh` are what ENTER the scope, so they are looked up on THIS machine —
//! asking a distribution where its own `wsl.exe` is would be circular.

use std::sync::{Arc, Mutex};

use crate::fakes::{Asked, FakeCommand, unit_host, unit_host_controlled, unit_settings};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::detect::detect_automatic_settings;
use cdc_runtime::domain::types::connection::{EngineConnectorSettings, SshHost, SshHostType};
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::Controller;
use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::EngineEnvironment;
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::host_client::HostClient;
use cdc_runtime::runtimes::profiles::shared::{SshProfile, WslProfile};
use cdc_runtime::runtimes::transports::ssh::SshTransport;
use cdc_runtime::runtimes::transports::wsl::WslTransport;

fn scope(name: &str) -> ControllerScope {
    ControllerScope::SshHost(SshHost {
        config_host: None,
        connected: None,
        host: name.to_string(),
        host_name: "192.168.122.5".to_string(),
        identity_file: String::new(),
        name: name.to_string(),
        port: 22,
        type_: SshHostType::SshConnection,
        usable: None,
        user: "tester".to_string(),
    })
}

fn remote_host(
    os: OperatingSystem,
    bound: bool,
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
        if bound {
            host.with_scope(Some(scope("win11")))
        } else {
            host
        },
        log,
    )
}

/// The two probes that locate `ssh` on THIS machine, before anything is asked of the remote.
///
/// `ssh -V` and not `ssh --version`: the version strategy is chosen from the path, and OpenSSH
/// answers `-V` on stderr.
fn ssh_controller_lookup() -> Vec<Vec<String>> {
    vec![
        vec!["which".to_string(), "ssh".to_string()],
        vec!["/usr/bin/ssh".to_string(), "-V".to_string()],
    ]
}

/// Whether this argv is the PowerShell probe that locates a program on a Windows CLIENT.
fn asks_powershell_for(argv: &[&str], needle: &str) -> bool {
    argv.last().is_some_and(|script| script.contains(needle))
}

/// A remote that locates its controller and then answers every engine question through the link.
fn remote_answers(argv: &[&str]) -> CommandExecutionResult {
    match argv {
        ["which", "ssh"] => CommandExecutionResult::ok("/usr/bin/ssh\n"),
        ["/usr/bin/ssh", "-V"] => CommandExecutionResult::ok(""),
        // A Windows client looks its own `ssh.exe` up through PowerShell instead.
        _ if asks_powershell_for(argv, "gcm") => {
            CommandExecutionResult::ok(r"C:\Windows\System32\OpenSSH\ssh.exe")
        }
        _ if argv.contains(&"which") => CommandExecutionResult::ok("/usr/bin/podman\n"),
        _ if argv.contains(&"--version") => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/podman.sock"}}}"#),
    }
}

#[tokio::test]
async fn every_probe_about_the_engine_travels_through_ssh_and_none_is_run_locally() {
    let (host, log) = remote_host(OperatingSystem::Linux, true, remote_answers);

    let resolved =
        detect_automatic_settings(&host, &unit_settings(), &EngineEnvironment::default())
            .await
            .expect("a bound scope detects");

    let asked = log.lock().expect("asked");
    let (controller, engine) = asked.argv.split_at(ssh_controller_lookup().len());
    assert_eq!(
        controller,
        ssh_controller_lookup(),
        "the controller is located here, because `ssh` is what this machine runs to reach the remote"
    );
    assert!(
        engine.iter().all(|argv| argv[0] == "ssh"),
        "and every launcher after it is ssh, so nothing about the ENGINE was answered by this \
         machine: {engine:?}"
    );
    assert_eq!(
        resolved.api.connection.relay, "/run/podman.sock",
        "what the REMOTE engine reported is the far end of the tunnel, not the local uri"
    );
    assert!(
        !resolved.api.connection.uri.is_empty(),
        "and the local end was derived, because detection leaves it empty for a remote"
    );
}

#[tokio::test]
async fn a_scoped_host_with_no_scope_asks_this_machine_about_the_controller_and_nothing_else() {
    // Running the ENGINE probe unwrapped would find the LOCAL engine and report it as the remote's,
    // and a transport with no scope refuses rather than allowing that. The CONTROLLER is not the same
    // question: `ssh` runs here, so `findHostProgram` is what the original asks for it.
    let (host, log) = remote_host(OperatingSystem::Linux, false, remote_answers);

    let resolved =
        detect_automatic_settings(&host, &unit_settings(), &EngineEnvironment::default())
            .await
            .expect("the OS gate passes — ssh runs everywhere");

    assert_eq!(
        log.lock().expect("asked").argv,
        ssh_controller_lookup(),
        "the controller, and nothing else — no engine probe ran against the wrong machine"
    );
    assert_eq!(
        resolved
            .controller
            .expect("the controller is resolved")
            .path,
        "/usr/bin/ssh"
    );
    assert_eq!(
        resolved.program.path.as_deref(),
        Some("/usr/bin/podman"),
        "and the engine is LEFT as it came in: SSH offers no default scope, so the original detects \
         no program rather than replacing one with nothing"
    );
}

#[tokio::test]
async fn the_ssh_profile_gate_passes_on_every_client_os() {
    // `availableAlways` — the gate asks where the CLIENT runs, and `ssh` runs everywhere. Whether
    // the REMOTE can run the engine is the remote's business, and the probe is what finds that out.
    for os in [
        OperatingSystem::Linux,
        OperatingSystem::Darwin,
        OperatingSystem::WindowsNt,
    ] {
        let (host, _) = remote_host(os, true, remote_answers);
        assert!(
            detect_automatic_settings(&host, &unit_settings(), &EngineEnvironment::default())
                .await
                .is_ok(),
            "ssh runs on {os:?}"
        );
    }
}

#[tokio::test]
async fn a_windows_client_is_imposed_a_named_pipe_and_a_posix_one_derives_a_socket() {
    // Only Windows has an address to IMPOSE: the relay serves a named pipe and a client cannot reach
    // the engine any other way. POSIX derives a socket path instead, and only as a LAST resort.
    let (windows, _) = remote_host(OperatingSystem::WindowsNt, true, |argv| {
        if asks_powershell_for(argv, "gcm") {
            return CommandExecutionResult::ok(r"C:\Windows\System32\OpenSSH\ssh.exe");
        }
        if argv.contains(&"which") {
            return CommandExecutionResult::ok("C:\\podman.exe\n");
        }
        CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/podman.sock"}}}"#)
    });
    let resolved =
        detect_automatic_settings(&windows, &unit_settings(), &EngineEnvironment::default())
            .await
            .expect("detects");
    assert!(
        resolved.api.connection.uri.starts_with(r"\\.\pipe\"),
        "a windows client is handed a named pipe: {}",
        resolved.api.connection.uri
    );
    assert!(
        resolved
            .api
            .connection
            .uri
            .contains("host.default.podman.remote"),
        "and it is qualified with the connection, so two remotes cannot collide"
    );

    let (posix, _) = remote_host(OperatingSystem::Linux, true, remote_answers);
    let resolved =
        detect_automatic_settings(&posix, &unit_settings(), &EngineEnvironment::default())
            .await
            .expect("detects");
    assert!(
        resolved.api.connection.uri.ends_with(".sock"),
        "a posix client binds a socket: {}",
        resolved.api.connection.uri
    );
}

#[tokio::test]
async fn a_preset_local_address_survives_detection() {
    // `imposed || preset || derived`. Overwriting a preset address is what invariants forbid: a user
    // who configured an endpoint the engine cannot be asked about must keep it.
    let (host, _) = remote_host(OperatingSystem::Linux, true, remote_answers);
    let mut preset = unit_settings();
    preset.api.connection.uri = "/tmp/my-own.sock".to_string();

    let resolved = detect_automatic_settings(&host, &preset, &EngineEnvironment::default())
        .await
        .expect("detects");

    assert_eq!(resolved.api.connection.uri, "/tmp/my-own.sock");
}

#[tokio::test]
async fn a_scope_belonging_to_another_transport_is_refused_by_name() {
    let command = FakeCommand::agreeable();
    let host = unit_host(
        "host.default.podman.remote",
        Box::new(SshTransport),
        Box::new(PodmanDialect),
        Box::new(SshProfile::PODMAN),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ControllerScope::WslDistribution(
        cdc_runtime::domain::types::machine::WslDistribution {
            current: false,
            default: true,
            name: "Ubuntu".to_string(),
            state: "Running".to_string(),
            type_: cdc_runtime::domain::types::machine::WslDistributionType::WslDistribution,
            usable: Some(true),
            version: "2".to_string(),
        },
    )));

    let refusal = cdc_runtime::runtimes::composition::Transport::run_scope_command(
        &SshTransport,
        &host,
        "podman",
        &["info".to_string()],
        &unit_settings(),
    )
    .await
    .expect_err("a WSL distribution is not an SSH host");

    assert_eq!(refusal.code, DiagnosticCode::ScopeNotSet);
}

// A CONTROLLER that is not `ssh`, and a transport whose default scope is a real answer. WSL is the
// one that exercises both halves of the scoped branch: `wsl.exe` is looked up on the Windows CLIENT,
// and `wsl -l -v` offers a distribution to adopt when the settings name none.

const WSL_LAUNCHER: &str = r"C:\Windows\System32\wsl.exe";

/// A Windows client whose engine lives in a distribution.
///
/// `scope` is the VALUE the machine resolved, which is `None` for every connection that has not
/// named one yet — the case the default-scope branch exists for.
fn wsl_host(
    scope: Option<ControllerScope>,
    respond: fn(&[&str]) -> CommandExecutionResult,
) -> (HostClient, Arc<Mutex<Asked>>) {
    let command = FakeCommand::answering(respond);
    let log = command.log();
    let host = unit_host_controlled(
        "host.default.podman.wsl",
        Box::new(WslTransport),
        Box::new(PodmanDialect),
        Box::new(WslProfile::PODMAN),
        OperatingSystem::WindowsNt,
        command,
        "wsl",
    )
    .with_scope(scope);
    (host, log)
}

/// Settings that name a distribution, or name none.
///
/// The controller carries NO path: detection is what fills it in, and starting from a filled one
/// would let a test pass on the value it supplied.
fn wsl_settings(scope: &str) -> EngineConnectorSettings {
    let mut settings = unit_settings();
    settings.controller = Some(Controller {
        auto: None,
        homepage: None,
        name: "wsl".to_string(),
        path: String::new(),
        scope: (!scope.is_empty()).then(|| scope.to_string()),
        title: None,
        version: None,
    });
    settings
}

/// The three PowerShell scripts a WSL detection runs, told apart by what each one asks for, plus the
/// engine probes that enter the distribution.
fn wsl_answers(argv: &[&str]) -> CommandExecutionResult {
    if asks_powershell_for(argv, "gcm") {
        return CommandExecutionResult::ok(WSL_LAUNCHER);
    }
    if asks_powershell_for(argv, "Get-AppxPackage") {
        return CommandExecutionResult::ok(r#"{"Version":"2.6.1"}"#);
    }
    if asks_powershell_for(argv, "-l -v") {
        return CommandExecutionResult::ok(
            r#"["  NAME      STATE     VERSION","* Ubuntu    Running   2","  Alpine    Stopped   2"]"#,
        );
    }
    if argv.contains(&"which") {
        return CommandExecutionResult::ok("/usr/bin/podman\n");
    }
    if argv.contains(&"--version") {
        return CommandExecutionResult::ok("podman version 5.6.2");
    }
    CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/podman.sock"}}}"#)
}

/// The same, with a default distribution that is STOPPED — `Usable` is false and the engine inside it
/// cannot be asked anything.
fn wsl_stopped_default(argv: &[&str]) -> CommandExecutionResult {
    if asks_powershell_for(argv, "-l -v") {
        return CommandExecutionResult::ok(
            r#"["  NAME      STATE     VERSION","* Alpine    Stopped   2"]"#,
        );
    }
    wsl_answers(argv)
}

#[tokio::test]
async fn the_controller_is_located_on_this_machine_because_it_is_what_enters_the_scope() {
    let (host, log) = wsl_host(Some(ubuntu()), wsl_answers);

    let resolved = detect_automatic_settings(
        &host,
        &wsl_settings("Ubuntu"),
        &EngineEnvironment::default(),
    )
    .await
    .expect("a bound distribution detects");

    let controller = resolved
        .controller
        .expect("a scoped host resolves its controller");
    assert_eq!(controller.name, "wsl", "the name the CONNECTOR registered");
    assert_eq!(controller.path, WSL_LAUNCHER);
    assert_eq!(
        controller.version.as_deref(),
        Some("2.6.1"),
        "and its version, which for `wsl.exe` is an AppX query rather than a `--version` flag"
    );
    assert_eq!(
        log.lock().expect("asked").argv[0],
        vec!["powershell.exe", "-Command", "((gcm 'wsl.exe').Path)"],
        "asked of THIS machine: a distribution cannot be entered to be asked where its own `wsl` is"
    );
}

#[tokio::test]
async fn the_scope_the_settings_already_name_survives_the_controller_assignment() {
    // The original assigns the program and then puts the scope BACK, in that order, because a program
    // lookup answers no scope of its own. Losing it would disconnect a working connection.
    let (host, _) = wsl_host(Some(ubuntu()), wsl_answers);

    let resolved = detect_automatic_settings(
        &host,
        &wsl_settings("Ubuntu"),
        &EngineEnvironment::default(),
    )
    .await
    .expect("detects");

    assert_eq!(
        resolved.controller.expect("controller").scope.as_deref(),
        Some("Ubuntu")
    );
}

#[tokio::test]
async fn the_engine_is_still_probed_inside_the_distribution() {
    let (host, log) = wsl_host(Some(ubuntu()), wsl_answers);

    let resolved = detect_automatic_settings(
        &host,
        &wsl_settings("Ubuntu"),
        &EngineEnvironment::default(),
    )
    .await
    .expect("detects");

    assert_eq!(resolved.program.path.as_deref(), Some("/usr/bin/podman"));
    assert_eq!(
        log.lock().expect("asked").argv[2],
        vec![
            WSL_LAUNCHER,
            "--distribution",
            "Ubuntu",
            "--exec",
            "which",
            "podman"
        ],
        "through the controller detection JUST located, and inside the distribution — the whole \
         argv, because a tail would not show which distribution was entered"
    );
}

#[tokio::test]
async fn a_scoped_host_naming_no_scope_adopts_the_one_its_transport_offers() {
    // The hole the scoped transports opened: SSH credentials arrive with the scope VALUE, but WSL,
    // LIMA and podman-machine enter their scope with the CONTROLLER, and nothing detected which one.
    let (host, _) = wsl_host(None, wsl_answers);

    let resolved =
        detect_automatic_settings(&host, &wsl_settings(""), &EngineEnvironment::default())
            .await
            .expect("detects");

    assert_eq!(
        resolved.controller.expect("controller").scope.as_deref(),
        Some("Ubuntu"),
        "the FIRST distribution offered, which is what this transport calls its default"
    );
}

#[tokio::test]
async fn an_unusable_default_scope_is_adopted_and_its_engine_is_left_alone() {
    // "Default scope is not usable - program will not be detected". A stopped distribution answers
    // nothing, and a lookup run against it would replace a known engine path with an absence.
    let (host, log) = wsl_host(None, wsl_stopped_default);

    let resolved =
        detect_automatic_settings(&host, &wsl_settings(""), &EngineEnvironment::default())
            .await
            .expect("detects");

    assert_eq!(
        resolved.controller.expect("controller").scope.as_deref(),
        Some("Alpine"),
        "it is still ADOPTED — the next attempt is the one that can enter it"
    );
    assert_eq!(
        resolved.program,
        unit_settings().program,
        "and the engine is untouched"
    );
    assert!(
        !log.lock()
            .expect("asked")
            .argv
            .iter()
            .any(|argv| argv.contains(&"which".to_string())),
        "nothing was asked of a distribution that is not running"
    );
}

#[tokio::test]
async fn a_transport_that_offers_no_default_leaves_the_scope_unnamed() {
    // A machine with no distributions at all: the listing answers nothing, so there is nothing to
    // adopt. "No default scope found - program will not be detected" — and the controller that WAS
    // found is still recorded, because it is what a user needs to install a distribution with.
    let (host, log) = wsl_host(None, |argv| {
        if asks_powershell_for(argv, "-l -v") {
            return CommandExecutionResult::failed(1, "no distributions");
        }
        wsl_answers(argv)
    });

    let resolved =
        detect_automatic_settings(&host, &wsl_settings(""), &EngineEnvironment::default())
            .await
            .expect("detection does not fail over a scope nobody offers");

    let controller = resolved.controller.expect("controller");
    assert_eq!(controller.scope, None);
    assert_eq!(controller.path, WSL_LAUNCHER);
    assert_eq!(
        resolved.program,
        unit_settings().program,
        "and the engine is left as it came in rather than replaced with an absence"
    );
    assert!(
        !log.lock()
            .expect("asked")
            .argv
            .iter()
            .any(|argv| argv.contains(&"which".to_string())),
        "no scope was found, so nothing was entered to be asked"
    );
}

/// The distribution these tests connect to, running.
fn ubuntu() -> ControllerScope {
    ControllerScope::WslDistribution(cdc_runtime::domain::types::machine::WslDistribution {
        current: false,
        default: true,
        name: "Ubuntu".to_string(),
        state: "Running".to_string(),
        type_: cdc_runtime::domain::types::machine::WslDistributionType::WslDistribution,
        usable: Some(true),
        version: "2".to_string(),
    })
}

/// What `podman system connection list --format json` reports on a remote running a machine.
const REMOTE_MACHINE_CONNECTIONS: &str = r#"[
  {"Name":"podman-machine-default","URI":"ssh://core@127.0.0.1:56515/run/user/1000/podman/podman.sock",
   "Identity":"/home/tester/.ssh/machine","IsMachine":true,"Default":true}
]"#;

#[tokio::test]
async fn a_remote_running_a_podman_machine_composes_a_connection_that_can_be_dialled() {
    // The whole chain, end to end: detection asks the remote for its connection list, the transport
    // nests a second hop into the machine, and the profile CARRIES it. Each link is asserted alone
    // elsewhere; what this pins is that they compose — a bridge resolved and then dropped leaves the
    // connection reporting an address inside a VM that no client on this machine can open, which is
    // exactly the shape `wsl-args.ts` had before it was found.
    let (host, _) = remote_host(OperatingSystem::WindowsNt, true, |argv| {
        if argv.contains(&"connection") {
            return CommandExecutionResult::ok(REMOTE_MACHINE_CONNECTIONS);
        }
        remote_answers(argv)
    });

    let resolved =
        detect_automatic_settings(&host, &unit_settings(), &EngineEnvironment::default())
            .await
            .expect("a bound scope detects");

    let bridge = &resolved.api.connection.dial_stdio_command;
    assert_eq!(
        bridge.first().map(String::as_str),
        Some("ssh"),
        "{bridge:?}"
    );
    assert_eq!(
        bridge.last().map(String::as_str),
        Some("dial-stdio"),
        "{bridge:?}"
    );
    assert_eq!(
        bridge.iter().filter(|word| *word == "ssh").count(),
        2,
        "TWO hops: this machine to the remote host, and the remote host into the machine — {bridge:?}"
    );
    assert!(
        bridge.contains(&"core@127.0.0.1".to_string()),
        "the machine podman listed, reached with the identity podman keeps for it — {bridge:?}"
    );
}

#[tokio::test]
async fn a_remote_with_no_machine_composes_the_engines_own_bridge() {
    // The plain arm, end to end: no machine, so ONE hop carrying the engine's own `dial-stdio`
    // against the socket it just reported. `relay` still names that socket — it is what the bridge
    // reaches, and `start_api` reads the bridge to know the forward is not wanted.
    let (host, _) = remote_host(OperatingSystem::Linux, true, remote_answers);

    let resolved =
        detect_automatic_settings(&host, &unit_settings(), &EngineEnvironment::default())
            .await
            .expect("a bound scope detects");

    let bridge = &resolved.api.connection.dial_stdio_command;
    assert_eq!(
        bridge.iter().filter(|word| *word == "ssh").count(),
        1,
        "ONE hop: the engine is on the remote host itself — {bridge:?}"
    );
    assert_eq!(
        &bridge[bridge.len() - 3..],
        &[
            "podman".to_string(),
            "system".to_string(),
            "dial-stdio".to_string()
        ],
        "{bridge:?}"
    );
    assert_eq!(resolved.api.connection.relay, "/run/podman.sock");
}
