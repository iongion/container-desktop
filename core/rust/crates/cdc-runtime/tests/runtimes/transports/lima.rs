//! The LIMA transport — `runtimes/transports/lima.ts`.
//!
//! Engine-agnostic, unlike the WSL one: `start_api` starts the INSTANCE and never asks the dialect, so
//! the same argv serves Podman-LIMA and Docker-LIMA. The argv is asserted whole for the reason every
//! transport's is.
//!
//! The address a connection ends up with is [`socket`], split out for the 620-line cap.

mod socket;

use std::sync::{Arc, Mutex};

use crate::fakes::APP_VERSION;
use crate::fakes::{Asked, FakeCommand, unit_host_controlled, unit_settings};
use cdc_runtime::capabilities::command::{CommandExecutionResult, ReadinessCheck};
use cdc_runtime::capabilities::http::Endpoint;
use cdc_runtime::domain::types::connection::EngineConnectorSettings;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::Controller;
use cdc_runtime::domain::types::host::StartupStatus;
use cdc_runtime::domain::types::machine::{ControllerScope, LimaInstance};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{HostContext, Transport};
use cdc_runtime::runtimes::dialects::docker::DockerDialect;
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::host_client::HostClient;
use cdc_runtime::runtimes::profiles::shared::LimaProfile;
use cdc_runtime::runtimes::transports::lima::{
    INSTANCES_HEADER_LINES, LimaTransport, instance_name, lima_instances,
};
use cdc_runtime::runtimes::transports::native::{API_READINESS_ATTEMPTS, API_READINESS_WAIT};

const CONNECTION: &str = "host.default.podman.lima";
const LIMACTL: &str = "/opt/homebrew/bin/limactl";
/// `limactl list --format json <name>` — one object per line, `portForwards` inside `config`. Shaped
/// off a real Mac, then given BOTH engines plus a port-only rule, so selecting the right forward is
/// asserted rather than assumed.
const REPORT: &str = concat!(
    r#"{"name":"lima-podman","status":"Running","config":{"portForwards":["#,
    r#"{"guestPortRange":[1,65535],"hostPortRange":[1,65535]},"#,
    r#"{"guestSocket":"/run/user/501/podman/podman.sock","#,
    r#""hostSocket":"/Users/tester/.lima/lima-podman/sock/podman.sock"},"#,
    r#"{"guestSocket":"/var/run/docker.sock","#,
    r#""hostSocket":"/Users/tester/.lima/lima-podman/sock/second.sock"}]}}"#
);

const LISTING: &str = "NAME       STATUS     SSH                ARCH       CPUS    MEMORY    DISK      DIR\n\
                       lima-podman Running    127.0.0.1:60022    aarch64    4       4GiB      100GiB    /Users/tester/.lima/lima-podman\n\
                       lima-idle   Stopped    127.0.0.1:0        aarch64    2       2GiB      50GiB     /Users/tester/.lima/lima-idle";

/// An instance as `limactl list` reports one.
fn instance(
    name: &str,
    status: &str,
    ssh: &str,
    cpus: &str,
    memory: &str,
    disk: &str,
) -> ControllerScope {
    ControllerScope::LimaInstance(LimaInstance {
        arch: "aarch64".to_string(),
        cp_us: cpus.to_string(),
        dir: format!("/Users/tester/.lima/{name}"),
        disk: disk.to_string(),
        memory: memory.to_string(),
        name: name.to_string(),
        ssh: ssh.to_string(),
        status: status.to_string(),
        type_: cdc_runtime::domain::types::machine::LimaInstanceType::LimaInstance,
        usable: Some(status == "Running"),
    })
}

fn running_instance() -> Option<ControllerScope> {
    Some(instance(
        "lima-podman",
        "Running",
        "127.0.0.1:60022",
        "4",
        "4GiB",
        "100GiB",
    ))
}

fn lima_settings(scope: &str) -> EngineConnectorSettings {
    let mut settings = unit_settings();
    settings.controller = Some(Controller {
        auto: None,
        homepage: None,
        name: "limactl".to_string(),
        path: LIMACTL.to_string(),
        scope: (!scope.is_empty()).then(|| scope.to_string()),
        title: None,
        version: None,
    });
    settings
}

async fn mac(
    scope: Option<ControllerScope>,
    respond: fn(&[&str]) -> CommandExecutionResult,
) -> (HostClient, Arc<Mutex<Asked>>) {
    let command = FakeCommand::answering(respond);
    let log = command.log();
    let host = unit_host_controlled(
        CONNECTION,
        Box::new(LimaTransport),
        Box::new(PodmanDialect),
        Box::new(LimaProfile::PODMAN),
        OperatingSystem::Darwin,
        command,
        "limactl",
    )
    .with_scope(scope);
    host.set_settings(lima_settings("lima-podman")).await;
    (host, log)
}

#[test]
fn the_lima_transport_is_scoped_and_leaves_the_instance_it_started_running() {
    assert!(LimaTransport.is_scoped());
    assert!(
        LimaTransport.should_keep_started_scope_running(),
        "a VM that takes a minute to boot is not shut down behind a user's back"
    );
    assert!(
        !LimaTransport.opens_data_plane(),
        "`start_api` starts the INSTANCE — the caller's flag decides whether it is asked"
    );
}

#[tokio::test]
async fn a_scope_command_is_limactl_shell_and_nothing_else() {
    let (host, log) = mac(running_instance(), |_| CommandExecutionResult::ok("")).await;

    LimaTransport
        .run_scope_command(
            &host,
            "podman",
            &["info".to_string()],
            &lima_settings("lima-podman"),
        )
        .await
        .expect("a bound instance accepts a command");

    let asked = log.lock().expect("asked");
    assert_eq!(
        asked.argv[0],
        vec![LIMACTL, "shell", "lima-podman", "podman", "info"],
        "no `--exec` equivalent: `limactl shell` takes the command directly"
    );
    assert!(
        !asked.commands[0]
            .env
            .iter()
            .any(|(key, _)| key.eq_ignore_ascii_case("http_proxy")),
        "the guest's network is not this machine's, so the proxy variables stay behind"
    );
}

#[tokio::test]
async fn a_scope_of_any_other_kind_is_refused_by_the_name_the_schema_gives_it() {
    for (scope, named) in [
        (
            ControllerScope::PodmanMachine(
                serde_json::from_value(serde_json::json!({
                    "Name": "lima-podman", "Type": "PodmanMachine", "Active": true,
                    "Created": "c", "LastUp": "l", "Running": true, "Usable": true,
                    "VMType": "qemu"
                }))
                .expect("machine fixture parses"),
            ),
            "PodmanMachine",
        ),
        (
            ControllerScope::WslDistribution(
                serde_json::from_value(serde_json::json!({
                    "Name": "lima-podman", "Type": "WSLDistribution", "Version": "2",
                    "Default": true, "Current": false, "State": "Running"
                }))
                .expect("wsl fixture parses"),
            ),
            "WSLDistribution",
        ),
        (
            ControllerScope::SshHost(
                serde_json::from_value(serde_json::json!({
                    "Name": "lima-podman", "Type": "SSHConnection", "Host": "h", "HostName": "h",
                    "IdentityFile": "/home/tester/.ssh/id_rsa", "Port": 22, "User": "tester"
                }))
                .expect("ssh fixture parses"),
            ),
            "SSHConnection",
        ),
    ] {
        let (host, log) = mac(Some(scope), |_| CommandExecutionResult::ok("")).await;

        let refusal = LimaTransport
            .start_scope(&host)
            .await
            .expect_err("a LIMA transport cannot enter it");
        assert_eq!(refusal.code, DiagnosticCode::ScopeNotSet);
        assert_eq!(
            refusal.params,
            Some(serde_json::json!({ "transport": "lima", "scope": named }))
        );
        assert!(log.lock().expect("asked").argv.is_empty());
    }

    let (unbound, _) = mac(None, |_| CommandExecutionResult::ok("")).await;
    let refusal = LimaTransport
        .run_scope_command(&unbound, "podman", &[], &lima_settings(""))
        .await
        .expect_err("no instance, no command");
    assert_eq!(
        refusal.params,
        Some(serde_json::json!({ "transport": "lima", "program": "podman" }))
    );
}

#[tokio::test]
async fn a_running_instance_is_not_started_again_and_a_stopped_one_is() {
    let (running, log) = mac(running_instance(), |_| CommandExecutionResult::ok("")).await;
    assert_eq!(
        LimaTransport.start_scope(&running).await.expect("answers"),
        StartupStatus::Running,
        "`Running`, not `Started`: nothing here started it"
    );
    assert!(log.lock().expect("asked").argv.is_empty());

    let stopped = Some(instance(
        "lima-idle",
        "Stopped",
        "127.0.0.1:0",
        "2",
        "2GiB",
        "50GiB",
    ));
    let (host, log) = mac(stopped.clone(), |_| CommandExecutionResult::ok("")).await;
    assert_eq!(
        LimaTransport.start_scope(&host).await.expect("answers"),
        StartupStatus::Started
    );
    assert_eq!(
        log.lock().expect("asked").argv[0],
        vec![LIMACTL, "start", "lima-idle"]
    );

    let (refusing, _) = mac(stopped, |_| {
        CommandExecutionResult::failed(1, "instance is not stopped")
    })
    .await;
    assert_eq!(
        LimaTransport.start_scope(&refusing).await.expect("answers"),
        StartupStatus::Error
    );
}

#[tokio::test]
async fn stopping_an_instance_is_deliberately_not_done() {
    let (host, log) = mac(running_instance(), |_| CommandExecutionResult::ok("")).await;

    assert!(
        LimaTransport.stop_scope(&host).await.expect("answers"),
        "`true` because leaving the VM alone is the intended outcome"
    );
    assert!(log.lock().expect("asked").argv.is_empty());
}

#[tokio::test]
async fn starting_the_api_starts_the_instance_and_waits_for_its_socket() {
    let (host, log) = mac(running_instance(), |_| CommandExecutionResult::ok("")).await;
    let mut settings = lima_settings("lima-podman");
    settings.api.connection.uri =
        "/home/tester/.lima/lima-podman/sock/lima-podman.sock".to_string();

    assert!(
        LimaTransport
            .start_api(&host, &settings)
            .await
            .expect("the instance starts")
    );

    let asked = log.lock().expect("asked");
    let (id, command, opts) = &asked.services[0];
    assert_eq!(id.0, "api:host.default.podman.lima");
    assert_eq!(command.argv(), vec![LIMACTL, "start", "lima-podman"]);
    assert_eq!(opts.retry.count, API_READINESS_ATTEMPTS);
    assert_eq!(opts.retry.wait, API_READINESS_WAIT);
    assert_eq!(
        opts.check_status,
        ReadinessCheck::ApiAnswers {
            endpoint: Endpoint::UnixSocket(
                "/home/tester/.lima/lima-podman/sock/lima-podman.sock".to_string()
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
        }
    );
    assert!(
        asked.argv.is_empty(),
        "and the dialect was never asked for service args — starting the INSTANCE is the whole of it"
    );
}

#[tokio::test]
async fn docker_on_lima_starts_the_instance_exactly_as_podman_does() {
    // The one place this transport is provably engine-agnostic: Docker's dialect answers `None` to
    // `buildServiceArgs`, which would make a WSL host skip everything — here it changes nothing.
    let command = FakeCommand::agreeable();
    let log = command.log();
    let host = unit_host_controlled(
        "host.default.docker.lima",
        Box::new(LimaTransport),
        Box::new(DockerDialect),
        Box::new(LimaProfile::DOCKER),
        OperatingSystem::Darwin,
        command,
        "limactl",
    )
    .with_scope(running_instance());
    let mut settings = lima_settings("lima-podman");
    settings.api.connection.uri =
        "/home/tester/.lima/lima-podman/sock/lima-podman.sock".to_string();

    assert!(
        LimaTransport
            .start_api(&host, &settings)
            .await
            .expect("the instance starts")
    );
    assert_eq!(
        log.lock().expect("asked").services[0].1.argv(),
        vec![LIMACTL, "start", "lima-podman"]
    );
}

#[tokio::test]
async fn an_instance_that_will_not_start_is_forgiven_and_an_unresolved_socket_is_not() {
    let refusing = unit_host_controlled(
        CONNECTION,
        Box::new(LimaTransport),
        Box::new(PodmanDialect),
        Box::new(LimaProfile::PODMAN),
        OperatingSystem::Darwin,
        FakeCommand::agreeable().refusing_services(),
        "limactl",
    )
    .with_scope(running_instance());
    let mut settings = lima_settings("lima-podman");
    settings.api.connection.uri =
        "/home/tester/.lima/lima-podman/sock/lima-podman.sock".to_string();
    assert!(
        !LimaTransport
            .start_api(&refusing, &settings)
            .await
            .expect("an instance that will not start is an answer, not an error"),
        "it may already be up, and the availability check is what decides"
    );

    let (host, log) = mac(running_instance(), |_| CommandExecutionResult::ok("")).await;
    let refusal = LimaTransport
        .start_api(&host, &lima_settings("lima-podman"))
        .await
        .expect_err("an address nothing resolved is refused");
    assert_eq!(refusal.code, DiagnosticCode::ApiSocketUnresolved);
    assert!(log.lock().expect("asked").services.is_empty());
}

#[tokio::test]
async fn stopping_the_api_kills_the_service_and_leaves_the_instance_up() {
    let (host, log) = mac(running_instance(), |_| CommandExecutionResult::ok("")).await;

    assert!(
        LimaTransport
            .stop_api(&host, &lima_settings("lima-podman"))
            .await
            .expect("answers")
    );
    let asked = log.lock().expect("asked");
    assert_eq!(
        asked.killed,
        vec!["api:host.default.podman.lima".to_string()]
    );
    assert!(
        asked.argv.is_empty(),
        "no `limactl stop`: the original gates it on a runner flag this port does not keep, and \
         stopping unconditionally would take down a VM another connection is using"
    );
}

#[tokio::test]
async fn the_instances_are_listed_from_the_plain_table_limactl_prints() {
    let (host, log) = mac(running_instance(), |_| CommandExecutionResult::ok(LISTING)).await;

    let scopes = LimaTransport
        .list_scopes(&host, &lima_settings("lima-podman"))
        .await
        .expect("the instances are listed");

    assert_eq!(
        scopes,
        vec![
            instance(
                "lima-podman",
                "Running",
                "127.0.0.1:60022",
                "4",
                "4GiB",
                "100GiB"
            ),
            instance("lima-idle", "Stopped", "127.0.0.1:0", "2", "2GiB", "50GiB"),
        ],
        "the COLUMN ORDER is the contract — name, status, ssh, arch, cpus, memory, disk, dir"
    );
    assert_eq!(log.lock().expect("asked").argv[0], vec![LIMACTL, "list"]);
}

#[test]
fn the_columns_are_read_by_their_header_because_limactl_has_since_added_one() {
    // **Read off a real Mac, limactl 2.2.0**: the table now carries VMTYPE between SSH and ARCH.
    // Both trees split by POSITION — `[Name, Status, SSH, Arch, CPUs, Memory, Disk, Dir]` in
    // `shared.ts` and the same order here — so every field from the fourth on was shifted by one:
    // arch took `vz`, cpus took the arch, and the directory fell off the end entirely. Name and
    // status sit before the new column, which is why nothing noticed.
    let real = "NAME         STATUS     SSH                VMTYPE    ARCH       CPUS    MEMORY    DISK      DIR\n\
                ubuntu-vm    Running    127.0.0.1:50058    vz        aarch64    4       4GiB      100GiB    /Users/iongion/.lima/ubuntu-vm";

    let instances = lima_instances(real);

    assert_eq!(instances.len(), 1);
    assert_eq!(instances[0].name, "ubuntu-vm");
    assert_eq!(instances[0].arch, "aarch64", "not the VM type");
    assert_eq!(instances[0].cp_us, "4", "not the arch");
    assert_eq!(instances[0].memory, "4GiB");
    assert_eq!(instances[0].disk, "100GiB");
    assert_eq!(
        instances[0].dir, "/Users/iongion/.lima/ubuntu-vm",
        "the directory is the column that fell off the end"
    );
}

#[test]
fn an_instance_listing_survives_everything_that_is_not_an_instance() {
    assert_eq!(INSTANCES_HEADER_LINES, 1);
    assert!(
        lima_instances("NAME  STATUS").is_empty(),
        "a header alone lists nothing"
    );
    assert!(lima_instances("").is_empty());
    // A row with only some columns is still an instance — it just is not usable, and hiding it would
    // be worse than showing what is known about it.
    let partial = lima_instances("NAME  STATUS\nlima-podman");
    assert_eq!(partial.len(), 1);
    assert_eq!(partial[0].name, "lima-podman");
    assert_eq!(partial[0].status, "");
    assert_eq!(partial[0].usable, Some(false));
    assert_eq!(partial[0].dir, "");
}

#[tokio::test]
async fn the_default_scope_is_the_instance_the_settings_name_and_never_a_guess() {
    // WSL takes the first distribution; LIMA does not, and the difference is the original's: a Lima
    // instance may be any VM the user runs, so picking one for them is picking a stranger's.
    let (host, _) = mac(running_instance(), |_| CommandExecutionResult::ok(LISTING)).await;

    assert_eq!(
        LimaTransport
            .controller_default_scope(&host, &lima_settings("lima-idle"))
            .await
            .expect("answers"),
        Some(instance(
            "lima-idle",
            "Stopped",
            "127.0.0.1:0",
            "2",
            "2GiB",
            "50GiB"
        ))
    );
    assert_eq!(
        LimaTransport
            .controller_default_scope(&host, &lima_settings(""))
            .await
            .expect("answers"),
        None,
        "with nothing named there is nothing to resolve"
    );
    assert_eq!(
        LimaTransport
            .controller_default_scope(&host, &lima_settings("lima-gone"))
            .await
            .expect("answers"),
        None,
        "and a name no instance carries resolves to nothing rather than to the nearest one"
    );
}

#[tokio::test]
async fn nothing_is_listed_off_macos_without_asking_the_machine() {
    let command = FakeCommand::agreeable();
    let log = command.log();
    let host = unit_host_controlled(
        CONNECTION,
        Box::new(LimaTransport),
        Box::new(PodmanDialect),
        Box::new(LimaProfile::PODMAN),
        OperatingSystem::Linux,
        command,
        "limactl",
    );

    assert!(
        LimaTransport
            .list_scopes(&host, &lima_settings("lima-podman"))
            .await
            .expect("answers")
            .is_empty()
    );
    assert!(log.lock().expect("asked").argv.is_empty());
}

#[tokio::test]
async fn an_instance_that_cannot_be_listed_offers_no_scopes_and_no_preflight() {
    let (host, _) = mac(running_instance(), |_| {
        CommandExecutionResult::failed(127, "limactl: not found")
    })
    .await;

    assert!(
        LimaTransport
            .list_scopes(&host, &lima_settings("lima-podman"))
            .await
            .expect("answers")
            .is_empty()
    );
    assert!(
        LimaTransport
            .diagnose_scope(&host, Some("podman"))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn the_launcher_falls_back_to_the_registered_controller() {
    let mut settings = lima_settings("lima-podman");
    settings.controller = None;
    let (host, log) = mac(running_instance(), |_| CommandExecutionResult::ok("")).await;

    LimaTransport
        .run_scope_command(&host, "podman", &[], &settings)
        .await
        .expect("the registered controller is what remains");

    assert_eq!(
        log.lock().expect("asked").argv[0][0],
        "limactl",
        "and no `.exe` is appended off Windows"
    );
}

#[test]
fn an_instance_name_is_only_read_from_a_lima_scope() {
    // Selection matches a NAME against the scopes a host offers, and a name cannot say which kind it
    // belongs to — a podman machine may be called exactly what this connection's settings name. So
    // `None` here means "not mine" rather than "unnamed", and a version that answered for every kind
    // would let a Lima transport enter something that is not a Lima instance.
    assert_eq!(
        instance_name(&instance(
            "podman-machine-default",
            "Running",
            "127.0.0.1:60022",
            "4",
            "4GiB",
            "100GiB"
        )),
        Some("podman-machine-default")
    );
    assert_eq!(
        instance_name(&ControllerScope::PodmanMachine(
            serde_json::from_value(serde_json::json!({
                "Name": "podman-machine-default", "Type": "PodmanMachine", "Active": true,
                "Created": "c", "LastUp": "l", "Running": true, "Usable": true, "VMType": "qemu"
            }))
            .expect("machine fixture parses"),
        )),
        None,
        "a machine that shares the name is still not a Lima instance"
    );
}
