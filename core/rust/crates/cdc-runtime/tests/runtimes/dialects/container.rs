//! Apple's dialect — `runtimes/dialects/container.ts`.
//!
//! Its own file rather than a fourth engine inside `dialect.rs`, which the 600-line cap forced and
//! which is where the tests-mirror layout wants it anyway.
//!
//! **Written from the original and never run against a Mac.** Every rule asserted here is read off
//! `dialects/container.ts`; no macOS is reachable from anywhere this port can be built.

use crate::fakes::{FakeCommand, unit_host, unit_settings};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::types::connection::{SshHost, SshHostType};
use cdc_runtime::domain::types::engine::{ApiSurface, ContainerEngine};
use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{EngineDialect, EngineEnvironment, HostContext};
use cdc_runtime::runtimes::dialects::container::{AppleDialect, socktainer_socket};
use cdc_runtime::runtimes::profiles::container::AppleNativeProfile;
use cdc_runtime::runtimes::profiles::shared::SshProfile;
use cdc_runtime::runtimes::transports::native::NativeTransport;
use cdc_runtime::runtimes::transports::ssh::SshTransport;

/// An SSH scope, so a fixture is genuinely SCOPED and not merely composed with a transport that
/// would refuse every command it is handed.
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
fn apple_speaks_the_docker_surface_while_its_dialect_stays_its_own() {
    // Two separate questions, and answering `Libpod` here would pick Podman's normalizers for an
    // engine that serves Docker's REST shape through socktainer.
    assert_eq!(AppleDialect.engine(), ContainerEngine::Apple);
    assert_eq!(AppleDialect.api_surface(), ApiSurface::Docker);
}

#[test]
fn apples_socket_is_socktainers_under_a_home() {
    assert_eq!(
        socktainer_socket("/Users/tester"),
        "/Users/tester/.socktainer/container.sock"
    );
    assert_eq!(
        socktainer_socket("/Users/tester/"),
        "/Users/tester/.socktainer/container.sock",
        "a trailing separator must not double"
    );
    assert_eq!(
        socktainer_socket(""),
        "",
        "an unknown home is an unresolved socket, not `/.socktainer/container.sock` — a path that \
         names nothing while looking resolved is what would let the api check pass"
    );
}

#[tokio::test]
async fn apple_native_reads_this_machines_home_and_asks_the_engine_nothing() {
    let command = FakeCommand::answering(|argv| {
        panic!("Apple's socket is a convention, not a report, yet something ran: {argv:?}")
    });
    let host = unit_host(
        "host.manual.container.native",
        Box::new(NativeTransport),
        Box::new(AppleDialect),
        Box::new(AppleNativeProfile),
        OperatingSystem::Darwin,
        command,
    );

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/home/tester/.socktainer/container.sock",
        "the unscoped read costs no command at all — `scope_environment_variable` refuses first"
    );
}

#[tokio::test]
async fn apple_remote_reads_the_remotes_home_and_never_this_one() {
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"printenv") {
            return CommandExecutionResult::ok("/Users/remote\n");
        }
        CommandExecutionResult::ok("")
    });
    let host = unit_host(
        "host.default.container.remote",
        Box::new(SshTransport),
        Box::new(AppleDialect),
        Box::new(SshProfile::APPLE),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/Users/remote/.socktainer/container.sock",
        "the SCOPED home — this machine's would point the remote at a directory it does not have"
    );
}

#[test]
fn apple_seeds_from_nothing_because_docker_host_on_a_mac_is_somebody_elses_daemon() {
    // The one rule the dialect exists to enforce. Both variables are set here and BOTH are ignored:
    // seeding from `DOCKER_HOST` would connect the Apple host to Docker Desktop or colima, and that
    // connection would work, report healthy, and manage the wrong containers.
    let both = EngineEnvironment {
        podman_host: Some("unix:///podman.sock".to_string()),
        docker_host: Some("unix:///var/run/docker.sock".to_string()),
    };
    assert_eq!(AppleDialect.native_uri_seed(&both), "");
    assert_eq!(
        AppleDialect.native_uri_seed(&EngineEnvironment::default()),
        ""
    );
}

#[test]
fn apple_manages_no_service_either() {
    // `container system start` and socktainer are the user's to run — `None` means "start the host
    // manually", the same answer Docker gives.
    assert!(AppleDialect.build_service_args("/x.sock", "warn").is_none());
}

#[tokio::test]
async fn apple_describes_socktainer_as_a_program_rather_than_a_sentence() {
    // The original answers English prose. `ReportedDiagnostic.params` is documented "Never prose", so
    // the two facts the sentence carries travel as a `Program`: the name, and whether a path exists.
    let found = FakeCommand::answering(|argv| {
        if argv.contains(&"which") {
            return CommandExecutionResult::ok("/opt/homebrew/bin/socktainer\n");
        }
        CommandExecutionResult::ok("socktainer version 0.3.1")
    });
    let host = unit_host(
        "host.manual.container.native",
        Box::new(NativeTransport),
        Box::new(AppleDialect),
        Box::new(AppleNativeProfile),
        OperatingSystem::Darwin,
        found,
    );

    let bridge = AppleDialect
        .describe_api_bridge(&host, &unit_settings())
        .await
        .expect("Apple always has a bridge to report on");
    assert_eq!(bridge.name, "socktainer");
    assert_eq!(bridge.path.as_deref(), Some("/opt/homebrew/bin/socktainer"));

    // Not installed is an ANSWER, and it is spelled as an ABSENT path — the same spelling every other
    // lookup here uses, so a client renders "install socktainer" from a fact rather than from prose.
    let missing = unit_host(
        "host.manual.container.native",
        Box::new(NativeTransport),
        Box::new(AppleDialect),
        Box::new(AppleNativeProfile),
        OperatingSystem::Darwin,
        FakeCommand::answering(|_| CommandExecutionResult::failed(1, "not found")),
    );
    let absent = AppleDialect
        .describe_api_bridge(&missing, &unit_settings())
        .await
        .expect("still an answer");
    assert_eq!(absent.name, "socktainer");
    assert_eq!(absent.path, None);
}

#[test]
fn apple_ships_no_dial_stdio_and_says_so_rather_than_guessing_a_name() {
    // `container.ts` has no `resolveDialStdioBridge`. A `Some("container")` would compose a command
    // the remote refuses over a connection the forward reaches — Apple broken by fixing Docker.
    assert_eq!(AppleDialect.dial_stdio_program(), None);
}
