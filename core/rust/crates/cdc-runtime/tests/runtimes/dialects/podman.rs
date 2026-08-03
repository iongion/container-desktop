//! `runtimes/dialects/podman.ts` — where podman says it is listening.
//!
//! Two halves, tested apart because they fail apart: the PURE parse of whatever the engine printed,
//! and the COMMAND that produced it. A parse rule needs no host; the argv needs one, because the
//! dialect asks through the composed client and a scoped host must see the probe wrapped.

use crate::fakes::{FakeCommand, unit_host, unit_settings};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::types::connection::{SshHost, SshHostType};
use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{EngineDialect, EngineEnvironment, HostContext};
use cdc_runtime::runtimes::dialects::docker::DockerDialect;
use cdc_runtime::runtimes::dialects::podman::{
    PodmanDialect, pick_podman_machine_socket, read_socket_from_info,
};
use cdc_runtime::runtimes::profiles::podman::PodmanNativeProfile;
use cdc_runtime::runtimes::profiles::shared::SshProfile;
use cdc_runtime::runtimes::transports::native::NativeTransport;
use cdc_runtime::runtimes::transports::ssh::SshTransport;

fn ssh_scope() -> ControllerScope {
    ControllerScope::SshHost(SshHost {
        config_host: None,
        connected: None,
        host: "mac-mini".to_string(),
        host_name: "192.168.122.9".to_string(),
        identity_file: String::new(),
        name: "mac-mini".to_string(),
        port: 22,
        type_: SshHostType::SshConnection,
        usable: None,
        user: "tester".to_string(),
    })
}

#[test]
fn podman_reads_its_socket_from_system_info_and_strips_the_scheme() {
    assert_eq!(
        read_socket_from_info(
            r#"{"host":{"remoteSocket":{"path":"unix:///run/podman.sock","exists":true}}}"#
        ),
        "/run/podman.sock"
    );
}

#[test]
fn podman_honours_a_docker_host_seed_but_prefers_its_own() {
    // Podman disguised as Docker is honoured, which is why `DOCKER_HOST` appears in its seed at all.
    let both = EngineEnvironment {
        podman_host: Some("unix:///podman.sock".to_string()),
        docker_host: Some("unix:///docker.sock".to_string()),
    };
    assert_eq!(PodmanDialect.native_uri_seed(&both), "unix:///podman.sock");

    let docker_only = EngineEnvironment {
        podman_host: None,
        docker_host: Some("unix:///docker.sock".to_string()),
    };
    assert_eq!(
        PodmanDialect.native_uri_seed(&docker_only),
        "unix:///docker.sock"
    );
    assert_eq!(
        PodmanDialect.native_uri_seed(&EngineEnvironment::default()),
        ""
    );
}

#[test]
fn podman_has_a_managed_service_and_docker_does_not() {
    assert_eq!(
        PodmanDialect
            .build_service_args("/run/podman.sock", "debug")
            .expect("podman manages a service"),
        vec![
            "system",
            "service",
            "--time=0",
            "unix:///run/podman.sock",
            "--log-level=debug",
        ]
    );
    // `None` means "start the host manually", not "not implemented".
    assert!(
        DockerDialect
            .build_service_args("/x.sock", "warn")
            .is_none()
    );
}

#[tokio::test]
async fn the_socket_probe_is_the_engines_own_cli_and_runs_where_the_engine_is() {
    let command = FakeCommand::answering(|_| {
        CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/podman.sock"}}}"#)
    });
    let log = command.log();
    let host = unit_host(
        "host.manual.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        command,
    );

    let socket = host
        .dialect()
        .read_engine_socket(&host, &unit_settings())
        .await;

    assert_eq!(socket, "/run/podman.sock");
    assert_eq!(
        log.lock().expect("asked").argv,
        vec![vec![
            "/usr/bin/podman".to_string(),
            "system".to_string(),
            "info".to_string(),
            "--format".to_string(),
            "json".to_string(),
        ]],
        "the RESOLVED path is used, not the bare name"
    );
}

#[tokio::test]
async fn a_probe_that_exits_non_zero_reports_no_socket_and_does_not_parse_its_stderr() {
    let host = unit_host(
        "host.manual.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        FakeCommand::answering(|_| CommandExecutionResult::failed(125, "cannot connect")),
    );

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        ""
    );
}

#[test]
fn a_podman_machines_socket_is_the_running_ones() {
    // `machine inspect` answers an ARRAY, and the RUNNING machine wins over whatever is listed first
    // — a stopped machine's socket has no listener behind it.
    let two = r#"[
      {"Name":"old","State":"stopped","ConnectionInfo":{"PodmanSocket":{"Path":"/tmp/old.sock"}}},
      {"Name":"new","State":"running","ConnectionInfo":{"PodmanSocket":{"Path":"unix:///tmp/new.sock"}}}
    ]"#;
    assert_eq!(pick_podman_machine_socket(two), "/tmp/new.sock");

    // With none running the first is taken anyway: the path is where the socket WILL be, and the
    // original prefers a startable address over no address at all.
    let stopped =
        r#"[{"State":"stopped","ConnectionInfo":{"PodmanSocket":{"Path":"/tmp/old.sock"}}}]"#;
    assert_eq!(pick_podman_machine_socket(stopped), "/tmp/old.sock");

    // A lone object rather than an array — the original accepts it, so this does.
    let single =
        r#"{"State":"running","ConnectionInfo":{"PodmanSocket":{"Path":"/tmp/one.sock"}}}"#;
    assert_eq!(pick_podman_machine_socket(single), "/tmp/one.sock");

    for nothing in [
        "",
        "[]",
        "null",
        "{}",
        "not json",
        r#"[{"State":"running"}]"#,
    ] {
        assert_eq!(pick_podman_machine_socket(nothing), "", "{nothing:?}");
    }
}

#[tokio::test]
async fn output_from_a_failed_machine_inspect_is_not_parsed() {
    // The same rule on the podman side: `machine inspect` can print a stale body and exit non-zero,
    // and trusting it would resolve a socket for a machine podman just said it could not inspect.
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"uname") {
            return CommandExecutionResult::ok("Darwin\n");
        }
        if argv.contains(&"inspect") {
            return CommandExecutionResult {
                code: 125,
                stdout: r#"[{"State":"running","ConnectionInfo":{"PodmanSocket":{"Path":"/tmp/stale.sock"}}}]"#
                    .to_string(),
                stderr: "machine inspect failed".to_string(),
            };
        }
        CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/real.sock"}}}"#)
    });
    let host = unit_host(
        "host.default.podman.remote",
        Box::new(SshTransport),
        Box::new(PodmanDialect),
        Box::new(SshProfile::PODMAN),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/run/real.sock",
        "the stale body is discarded and `system info` answers instead"
    );
}

#[tokio::test]
async fn a_remote_mac_is_asked_for_its_machines_socket_before_system_info() {
    // The order is load-bearing: `system info` over a remote-Mac connection answers about something
    // that cannot be dialed, so the machine read has to come first or detection resolves an address
    // that looks fine and reaches nothing.
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"uname") {
            return CommandExecutionResult::ok("Darwin\n");
        }
        if argv.contains(&"inspect") {
            return CommandExecutionResult::ok(
                r#"[{"State":"running","ConnectionInfo":{"PodmanSocket":{"Path":"$HOME/.local/share/containers/podman/machine/qemu/podman.sock"}}}]"#,
            );
        }
        if argv.contains(&"printenv") {
            return CommandExecutionResult::ok("/Users/tester\n");
        }
        CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/wrong.sock"}}}"#)
    });
    let log = command.log();
    let host = unit_host(
        "host.default.podman.remote",
        Box::new(SshTransport),
        Box::new(PodmanDialect),
        Box::new(SshProfile::PODMAN),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    let socket = host
        .dialect()
        .read_engine_socket(&host, &unit_settings())
        .await;

    assert_eq!(
        socket, "/Users/tester/.local/share/containers/podman/machine/qemu/podman.sock",
        "the machine's socket, with `$HOME` expanded against the REMOTE home and not this one"
    );
    let asked = log.lock().expect("asked");
    assert!(
        asked.argv.iter().all(|argv| argv[0] == "ssh"),
        "every probe went through the scope: {:?}",
        asked.argv
    );
    assert!(
        !asked
            .argv
            .iter()
            .any(|argv| argv.contains(&"info".to_string())),
        "`system info` is never reached once the machine answered: {:?}",
        asked.argv
    );
}

#[tokio::test]
async fn a_scope_that_is_not_a_mac_falls_straight_through_to_system_info() {
    // The Darwin probe is what stands in for the original's `host.HOST === PODMAN_REMOTE` guard, so a
    // Linux guest — every WSL distribution, LIMA instance and podman machine there is — must pay one
    // `uname -s` and then behave exactly as before.
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"uname") {
            return CommandExecutionResult::ok("Linux\n");
        }
        if argv.contains(&"inspect") {
            panic!("a Linux guest must never be asked to inspect a podman machine");
        }
        CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/podman.sock"}}}"#)
    });
    let host = unit_host(
        "host.default.podman.remote",
        Box::new(SshTransport),
        Box::new(PodmanDialect),
        Box::new(SshProfile::PODMAN),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/run/podman.sock"
    );
}

#[tokio::test]
async fn a_remote_mac_with_no_machine_still_answers_from_system_info() {
    // `machine inspect` failing is not the end of the read — a Mac can run podman without a machine
    // of this app's making, and `system info` is then the only source there is.
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"uname") {
            return CommandExecutionResult::ok("Darwin\n");
        }
        if argv.contains(&"inspect") {
            return CommandExecutionResult::failed(125, "no machines");
        }
        CommandExecutionResult::ok(
            r#"{"host":{"remoteSocket":{"path":"/run/user/501/podman.sock"}}}"#,
        )
    });
    let host = unit_host(
        "host.default.podman.remote",
        Box::new(SshTransport),
        Box::new(PodmanDialect),
        Box::new(SshProfile::PODMAN),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/run/user/501/podman.sock"
    );
}

#[tokio::test]
async fn an_unscoped_podman_never_pays_for_the_darwin_probe() {
    // A native host cannot be a remote Mac, and `is_scoped` answers that without running anything —
    // which is what keeps this branch free for eleven of the twelve connectors.
    let command = FakeCommand::answering(|argv| {
        assert!(
            !argv.contains(&"uname"),
            "an unscoped host asked for the guest's OS: {argv:?}"
        );
        CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/podman.sock"}}}"#)
    });
    let host = unit_host(
        "host.manual.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        command,
    );

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/run/podman.sock"
    );
}

#[tokio::test]
async fn a_tilde_survives_a_guest_that_cannot_say_where_home_is() {
    // Unexpanded beats empty: `~/...` is at least the shape of an address a user can recognise in a
    // diagnostic, where "" is indistinguishable from "no machine at all".
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"uname") {
            return CommandExecutionResult::ok("Darwin\n");
        }
        if argv.contains(&"printenv") {
            return CommandExecutionResult::failed(1, "printenv: not found");
        }
        CommandExecutionResult::ok(
            r#"[{"State":"running","ConnectionInfo":{"PodmanSocket":{"Path":"~/.podman/machine.sock"}}}]"#,
        )
    });
    let host = unit_host(
        "host.default.podman.remote",
        Box::new(SshTransport),
        Box::new(PodmanDialect),
        Box::new(SshProfile::PODMAN),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "~/.podman/machine.sock"
    );
}

#[tokio::test]
async fn an_absolute_machine_socket_costs_no_home_lookup() {
    // `expandScopedSocketPath` reads the guest's home only when the path actually needs one. An
    // absolute socket must not pay a round-trip, which is the original's order and not a shortcut.
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"uname") {
            return CommandExecutionResult::ok("Darwin\n");
        }
        if argv.contains(&"printenv") {
            panic!("an absolute path asked the guest for its home: {argv:?}");
        }
        CommandExecutionResult::ok(
            r#"[{"State":"running","ConnectionInfo":{"PodmanSocket":{"Path":"/Users/tester/.podman/machine.sock"}}}]"#,
        )
    });
    let host = unit_host(
        "host.default.podman.remote",
        Box::new(SshTransport),
        Box::new(PodmanDialect),
        Box::new(SshProfile::PODMAN),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/Users/tester/.podman/machine.sock"
    );
}

#[test]
fn podman_bridges_a_remote_socket_with_its_own_dial_stdio() {
    // A fallback name, not the program: `settings.program.name || "podman"`. `Some` is also the
    // transport's permission to bridge at all.
    assert_eq!(PodmanDialect.dial_stdio_program(), Some("podman"));
}
