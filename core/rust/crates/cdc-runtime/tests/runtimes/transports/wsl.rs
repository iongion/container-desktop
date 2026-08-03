//! The WSL transport — `runtimes/transports/wsl.ts`.
//!
//! The engine runs INSIDE a distribution, so every observable here is an argv that enters one, and it
//! is asserted WHOLE. What separates this transport from SSH is what `start_api` opens: the engine's
//! own service in the guest, not this connection's data plane — so it is gated by the caller's
//! `start_api` flag and a failure to start it is forgiven.

use std::sync::{Arc, Mutex};
/// The stdio bridge this transport composes — the only way a Windows client reaches the guest engine.
mod dial_stdio;
mod listing;

use crate::fakes::{Asked, FakeCommand, unit_host_controlled, unit_settings};
use cdc_runtime::capabilities::command::{CommandExecutionResult, ReadinessCheck};
use cdc_runtime::domain::ssh::forward::windows_pipe_path;
use cdc_runtime::domain::types::connection::EngineConnectorSettings;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::Controller;
use cdc_runtime::domain::types::host::StartupStatus;
use cdc_runtime::domain::types::machine::{ControllerScope, WslDistribution, WslDistributionType};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{HostContext, Transport};
use cdc_runtime::runtimes::dialects::docker::DockerDialect;
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::host_client::HostClient;
use cdc_runtime::runtimes::profiles::shared::WslProfile;
use cdc_runtime::runtimes::transports::native::{API_READINESS_ATTEMPTS, API_READINESS_WAIT};
use cdc_runtime::runtimes::transports::wsl::{
    DISTRIBUTIONS_HEADER_LINES, WslTransport, windows_path_to_wsl_path, wsl_distributions,
};

const WSL_LAUNCHER: &str = r"C:\Windows\System32\wsl.exe";

/// A distribution as `wsl -l -v` reports one, with its usability as the caller resolved it.
fn distribution(name: &str, state: &str, default: bool) -> ControllerScope {
    ControllerScope::WslDistribution(WslDistribution {
        current: false,
        default,
        name: name.to_string(),
        state: state.to_string(),
        type_: WslDistributionType::WslDistribution,
        usable: Some(state == "Running"),
        version: "2".to_string(),
    })
}

/// Settings a WSL connection actually carries: the controller located, and the distribution NAMED.
fn wsl_settings(scope: &str) -> EngineConnectorSettings {
    let mut settings = unit_settings();
    settings.controller = Some(Controller {
        auto: None,
        homepage: None,
        name: "wsl".to_string(),
        path: WSL_LAUNCHER.to_string(),
        scope: (!scope.is_empty()).then(|| scope.to_string()),
        title: None,
        version: None,
    });
    settings
}

/// A Windows client whose engine lives in a distribution — `scope` names the one it resolved, or
/// nothing when the settings named a distribution the host does not offer.
async fn windows(
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
    // What the machine holds going into an attempt: `start_scope` takes no settings argument, so the
    // launcher it enters the distribution with comes from these.
    host.set_settings(wsl_settings("Ubuntu")).await;
    (host, log)
}

/// The distribution this transport's tests connect to, running unless said otherwise.
fn ubuntu() -> Option<ControllerScope> {
    Some(distribution("Ubuntu", "Running", true))
}

#[test]
fn the_wsl_transport_is_scoped_and_does_not_keep_a_distribution_it_started_running() {
    assert!(WslTransport.is_scoped());
    assert!(
        !WslTransport.should_keep_started_scope_running(),
        "a distribution this app started is this app's to leave"
    );
    assert!(
        !WslTransport.opens_data_plane(),
        "`start_api` starts the ENGINE's service inside the guest, so the caller's flag decides \
         whether it is asked at all — unlike an `ssh -NL` forward, which IS the data plane"
    );
}

#[tokio::test]
async fn a_scope_command_is_the_whole_wsl_invocation() {
    let (host, log) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;

    WslTransport
        .run_scope_command(
            &host,
            "podman",
            &["info".to_string()],
            &wsl_settings("Ubuntu"),
        )
        .await
        .expect("a bound distribution accepts a command");

    let asked = log.lock().expect("asked");
    assert_eq!(
        asked.argv[0],
        vec![
            WSL_LAUNCHER,
            "--distribution",
            "Ubuntu",
            "--exec",
            "podman",
            "info"
        ],
        "`--exec` runs the program directly rather than through the guest's login shell"
    );
    assert!(
        !asked.commands[0]
            .env
            .iter()
            .any(|(key, _)| key.eq_ignore_ascii_case("http_proxy")),
        "the proxy variables describe how to leave THIS machine, so a command inside the guest \
         must not carry them"
    );
    assert_eq!(
        asked.commands[0].timeout, None,
        "entering a distribution is local and needs no ceiling — `ssh`'s is what a REMOTE costs"
    );
}

#[tokio::test]
async fn the_launcher_is_the_configured_controller_and_falls_back_to_its_registered_name() {
    // `controller.path || controller.name || <what the connector registered>`. The original falls
    // through to `""` for this transport, which fails to spawn as `ENOENT ''` — a message about
    // nothing. The registered name is a real thing to try, for the same reason an undetected ENGINE is
    // still probed by name: it may be on the PATH, and on Windows `wsl.exe` always is.
    let (host, log) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;

    let mut by_name = wsl_settings("Ubuntu");
    by_name.controller.as_mut().expect("controller").path = String::new();
    WslTransport
        .run_scope_command(&host, "podman", &[], &by_name)
        .await
        .expect("the name alone still names a launcher");
    assert_eq!(
        log.lock().expect("asked").argv[0][0],
        "wsl.exe",
        "and `runHostCommand`'s Windows rule appends the suffix"
    );

    let mut nothing = wsl_settings("Ubuntu");
    nothing.controller = None;
    WslTransport
        .run_scope_command(&host, "podman", &[], &nothing)
        .await
        .expect("the registered controller is what remains");
    assert_eq!(
        log.lock().expect("asked").argv[1][0],
        "wsl.exe",
        "the connector registered `wsl`, and the Windows rule applies to it too"
    );
}

#[tokio::test]
async fn a_scope_of_any_other_kind_is_refused_by_the_name_the_schema_gives_it() {
    // A scope resolves by NAME, so this transport can be handed a machine or a Lima instance that
    // happens to be called what the settings named. Refused by KIND, and nothing runs.
    for (scope, named) in [
        (
            ControllerScope::LimaInstance(
                serde_json::from_value(serde_json::json!({
                    "Name": "Ubuntu", "Type": "LIMAInstance", "Status": "Running",
                    "Dir": "/home/tester/.lima/Ubuntu", "Arch": "x86_64", "CPUs": "4",
                    "Memory": "4GiB", "Disk": "100GiB", "SSH": "127.0.0.1:60022"
                }))
                .expect("lima fixture parses"),
            ),
            "LIMAInstance",
        ),
        (
            ControllerScope::PodmanMachine(
                serde_json::from_value(serde_json::json!({
                    "Name": "Ubuntu", "Type": "PodmanMachine", "Active": true,
                    "Created": "now", "LastUp": "now", "Running": true, "Usable": true,
                    "VMType": "wsl"
                }))
                .expect("machine fixture parses"),
            ),
            "PodmanMachine",
        ),
        (
            ControllerScope::SshHost(
                serde_json::from_value(serde_json::json!({
                    "Name": "Ubuntu", "Type": "SSHConnection", "Host": "h", "HostName": "h",
                    "IdentityFile": "/home/tester/.ssh/id_rsa", "Port": 22, "User": "tester"
                }))
                .expect("ssh fixture parses"),
            ),
            "SSHConnection",
        ),
    ] {
        let (host, log) = windows(Some(scope), |_| CommandExecutionResult::ok("")).await;

        let refusal = WslTransport
            .start_scope(&host)
            .await
            .expect_err("a WSL transport cannot enter it");
        assert_eq!(refusal.code, DiagnosticCode::ScopeNotSet);
        assert_eq!(
            refusal.params,
            Some(serde_json::json!({ "transport": "wsl", "scope": named }))
        );
        assert!(
            log.lock().expect("asked").argv.is_empty(),
            "and nothing was attempted in any distribution"
        );
    }
}

#[tokio::test]
async fn an_unresolved_scope_says_what_would_not_run() {
    let (host, _) = windows(None, |_| CommandExecutionResult::ok("")).await;

    let refusal = WslTransport
        .run_scope_command(&host, "podman", &[], &wsl_settings("Ubuntu"))
        .await
        .expect_err("no distribution, no command");
    assert_eq!(refusal.code, DiagnosticCode::ScopeNotSet);
    assert_eq!(
        refusal.params,
        Some(serde_json::json!({ "transport": "wsl", "program": "podman" }))
    );
}

#[tokio::test]
async fn a_distribution_already_running_is_not_started_again() {
    let (host, log) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;

    assert_eq!(
        WslTransport.start_scope(&host).await.expect("answers"),
        StartupStatus::Running,
        "`Running` rather than `Started`: nothing here started it"
    );
    assert!(
        log.lock().expect("asked").argv.is_empty(),
        "and it costs no command at all"
    );
}

#[tokio::test]
async fn a_stopped_distribution_is_started_by_running_something_in_it() {
    // `wsl --exec echo started` IS the start: entering a stopped distribution boots it, and the echo
    // is what proves it can run a program there afterwards.
    let (host, log) = windows(Some(distribution("Ubuntu", "Stopped", true)), |argv| {
        if argv.contains(&"echo") {
            return CommandExecutionResult::ok("started\n");
        }
        CommandExecutionResult::failed(1, "unexpected")
    })
    .await;

    assert_eq!(
        WslTransport.start_scope(&host).await.expect("answers"),
        StartupStatus::Started
    );
    assert_eq!(
        log.lock().expect("asked").argv[0],
        vec![
            WSL_LAUNCHER,
            "--distribution",
            "Ubuntu",
            "--exec",
            "echo",
            "started"
        ],
        "with the launcher taken from the settings the machine is holding"
    );
}

#[tokio::test]
async fn a_distribution_that_answers_without_echoing_is_an_error() {
    // The same rule the SSH probe follows: a zero exit alone is not evidence. A distribution that
    // prints a banner and exits 0 has not proved it can run the engine.
    let (host, _) = windows(Some(distribution("Ubuntu", "Stopped", true)), |_| {
        CommandExecutionResult::ok("Welcome to Ubuntu\n")
    })
    .await;

    assert_eq!(
        WslTransport.start_scope(&host).await.expect("answers"),
        StartupStatus::Error
    );
}

#[tokio::test]
async fn stopping_a_distribution_is_deliberately_not_done() {
    let (host, log) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;

    assert!(
        WslTransport.stop_scope(&host).await.expect("answers"),
        "`true` because leaving it alone is the intended outcome — another user may be inside it"
    );
    assert!(log.lock().expect("asked").argv.is_empty());
}

#[tokio::test]
async fn the_imposed_address_is_a_pipe_named_for_the_connection_unless_a_machine_owns_it() {
    // The engine's socket is inside the guest, so a Windows client reaches it through the app's relay
    // pipe. It is keyed by the CONNECTION — except for a podman machine, whose distribution is shared
    // by every connection that names it, so the pipe is keyed by the MACHINE instead.
    let (host, _) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;

    assert_eq!(
        WslTransport
            .resolve_scope_uri(&host, &wsl_settings("Ubuntu"), "")
            .await,
        windows_pipe_path("host.default.podman.wsl")
    );
    assert_eq!(
        WslTransport
            .resolve_scope_uri(&host, &wsl_settings("podman-machine-default"), "")
            .await,
        windows_pipe_path("podman-machine-default")
    );
    assert_eq!(
        WslTransport.local_forward_fallback(&host).await,
        "",
        "nothing is forwarded here: the imposed pipe is the whole answer"
    );
}

#[tokio::test]
async fn a_windows_path_reaches_the_guest_as_a_mount() {
    // The pickers hand back Windows paths; the engine runs where those files are mounted.
    let (host, _) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;
    assert_eq!(
        WslTransport
            .resolve_guest_path(&host, r"C:\Users\tester\ctx")
            .await,
        "/mnt/c/Users/tester/ctx"
    );

    for (local, guest) in [
        (r"C:\Users\tester\ctx", "/mnt/c/Users/tester/ctx"),
        ("C:/Users/tester/ctx", "/mnt/c/Users/tester/ctx"),
        (r"D:\", "/mnt/d"),
        ("D:", "/mnt/d"),
        ("C:ctx", "/mnt/c/ctx"),
        (r"C:\\double", "/mnt/c//double"),
        ("/tmp/ctx", "/tmp/ctx"),
        ("relative/ctx", "relative/ctx"),
        ("1:\\ctx", "1:\\ctx"),
        ("", ""),
    ] {
        assert_eq!(
            windows_path_to_wsl_path(local),
            guest,
            "{local} is seen as {guest} inside the distribution"
        );
    }
}

#[tokio::test]
async fn a_relay_with_no_directory_of_its_own_creates_nothing_before_the_service() {
    // `ensure_relay_directory` exists because podman does not create the directory of the socket it
    // is told to bind. A relay with no directory PART has none to create — a bare name has no `/` at
    // all, and a root-level socket's parent is `/`, which is already there. Creating either would be
    // `mkdir -p ""` or `mkdir -p /` inside the guest: one is an error, the other is a lie. The
    // service must still start in both cases, which is what separates "nothing to do" from "refuse".
    for relay in ["podman.sock", "/podman.sock"] {
        let (host, log) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;
        let mut settings = wsl_settings("Ubuntu");
        settings.api.connection.uri = windows_pipe_path("host.default.podman.wsl");
        settings.api.connection.relay = relay.to_string();

        assert!(
            WslTransport
                .start_api(&host, &settings)
                .await
                .expect("the guest's service starts")
        );

        let asked = log.lock().expect("asked");
        assert!(
            !asked
                .argv
                .iter()
                .any(|argv| argv.contains(&"mkdir".to_string())),
            "{relay} has no directory to make: {:?}",
            asked.argv
        );
        assert_eq!(
            asked.services.len(),
            1,
            "and the service still starts — nothing to create is not a failure"
        );
    }
}

#[tokio::test]
async fn podman_starts_its_own_service_inside_the_guest_on_the_relay_socket() {
    let (host, log) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;
    let mut settings = wsl_settings("Ubuntu");
    settings.api.connection.uri = windows_pipe_path("host.default.podman.wsl");
    settings.api.connection.relay = "unix:///run/user/1000/podman/podman.sock".to_string();

    assert!(
        WslTransport
            .start_api(&host, &settings)
            .await
            .expect("the guest's service starts")
    );

    let asked = log.lock().expect("asked");
    // The base directory FIRST, and inside the guest: podman does not create the directory of the
    // socket it is told to bind, and that directory is the distribution's, not this machine's.
    assert_eq!(
        asked.argv[0],
        vec![
            WSL_LAUNCHER,
            "--distribution",
            "Ubuntu",
            "--exec",
            "mkdir",
            "-p",
            "/run/user/1000/podman"
        ]
    );
    let (id, command, opts) = &asked.services[0];
    assert_eq!(id.0, "api:host.default.podman.wsl");
    assert_eq!(
        command.argv(),
        vec![
            WSL_LAUNCHER,
            "--distribution",
            "Ubuntu",
            "--exec",
            "/usr/bin/podman",
            "system",
            "service",
            "--time=0",
            "unix:///run/user/1000/podman/podman.sock",
            "--log-level=warn"
        ],
        "the ENGINE's argv is the dialect's, and the scheme is stripped before it is handed over"
    );
    assert_eq!(
        command.timeout, None,
        "a service outlives the call that starts it"
    );
    assert_eq!(opts.retry.count, API_READINESS_ATTEMPTS);
    assert_eq!(opts.retry.wait, API_READINESS_WAIT);
    // The socket it binds is the GUEST's, so no local path check can see it. The scope is what can be
    // asked, which is why readiness is a command here and a path everywhere else.
    match &opts.check_status {
        ReadinessCheck::CommandSucceeds { command } => assert_eq!(
            command.argv(),
            vec![
                WSL_LAUNCHER,
                "--distribution",
                "Ubuntu",
                "--exec",
                "test",
                "-S",
                "/run/user/1000/podman/podman.sock"
            ]
        ),
        other => panic!("a guest socket cannot be checked from here: {other:?}"),
    }
}

#[tokio::test]
async fn a_relay_directory_that_could_not_be_prepared_does_not_stop_the_service() {
    // The original logs a warning and carries on: the directory may exist already, and podman itself
    // is the thing that decides whether it can bind.
    let (host, log) = windows(ubuntu(), |argv| {
        if argv.contains(&"mkdir") {
            return CommandExecutionResult::failed(1, "read-only");
        }
        CommandExecutionResult::ok("")
    })
    .await;
    let mut settings = wsl_settings("Ubuntu");
    settings.api.connection.relay = "/run/podman/podman.sock".to_string();

    assert!(
        WslTransport
            .start_api(&host, &settings)
            .await
            .expect("starts")
    );
    assert_eq!(
        log.lock().expect("asked").services.len(),
        1,
        "the service was still spawned"
    );
}

#[tokio::test]
async fn docker_inside_a_distribution_manages_its_own_service() {
    // `buildServiceArgs` answers `None`, which means "start the host manually" and NOT "not
    // implemented" — the original logs "Start api skipped - not required" and answers TRUE.
    let command = FakeCommand::agreeable();
    let log = command.log();
    let host = unit_host_controlled(
        "host.default.docker.wsl",
        Box::new(WslTransport),
        Box::new(DockerDialect),
        Box::new(WslProfile::DOCKER),
        OperatingSystem::WindowsNt,
        command,
        "wsl",
    )
    .with_scope(ubuntu());
    let mut settings = wsl_settings("Ubuntu");
    settings.api.connection.relay = "/var/run/docker.sock".to_string();

    assert!(
        WslTransport
            .start_api(&host, &settings)
            .await
            .expect("nothing to start is not a failure")
    );
    let asked = log.lock().expect("asked");
    assert!(
        asked.services.is_empty() && asked.argv.is_empty(),
        "and nothing at all was run — not even the base directory"
    );
}

#[tokio::test]
async fn a_service_that_will_not_start_is_forgiven_because_something_else_may_have_started_it() {
    // The opposite of an `ssh -NL` forward: the engine inside the guest may already be serving, so
    // the availability check decides. An `Err` here would fail an attempt that should carry on.
    let host = unit_host_controlled(
        "host.default.podman.wsl",
        Box::new(WslTransport),
        Box::new(PodmanDialect),
        Box::new(WslProfile::PODMAN),
        OperatingSystem::WindowsNt,
        FakeCommand::agreeable().refusing_services(),
        "wsl",
    )
    .with_scope(ubuntu());
    let mut settings = wsl_settings("Ubuntu");
    settings.api.connection.relay = "/run/podman/podman.sock".to_string();

    assert!(
        !WslTransport
            .start_api(&host, &settings)
            .await
            .expect("a refused service is an answer, not an error"),
        "and the answer is FALSE, which the availability check then contradicts or confirms"
    );
}

#[tokio::test]
async fn a_relay_nothing_resolved_is_refused_rather_than_bound_as_unix_nothing() {
    // `podman system service unix://` binds nothing. Detection not having resolved the guest's socket
    // is the fault, and naming it beats spawning a service that cannot listen.
    let (host, log) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;

    let refusal = WslTransport
        .start_api(&host, &wsl_settings("Ubuntu"))
        .await
        .expect_err("an empty relay is refused");
    assert_eq!(refusal.code, DiagnosticCode::ApiSocketUnresolved);
    assert!(
        log.lock().expect("asked").argv.is_empty(),
        "and no directory was prepared for a socket that has no path"
    );
}

#[tokio::test]
async fn stopping_the_api_kills_the_service_this_connection_started() {
    let (host, log) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;

    assert!(
        WslTransport
            .stop_api(&host, &wsl_settings("Ubuntu"))
            .await
            .expect("answers")
    );
    assert_eq!(
        log.lock().expect("asked").killed,
        vec!["api:host.default.podman.wsl".to_string()],
        "by the connection's name, so it never reaches another connection's service"
    );
}
