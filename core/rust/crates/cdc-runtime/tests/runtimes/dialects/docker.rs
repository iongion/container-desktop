//! `runtimes/dialects/docker.ts` — where docker says it is listening.
//!
//! `context inspect` rather than an environment variable, and the scoped `DOCKER_HOST` fallback the
//! oracle's own version of dropped on the path it was written for.

// Copied rather than shared with `podman.rs`: two source modules, two blast radii.
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

use crate::fakes::{FakeCommand, unit_host, unit_settings};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::types::connection::{SshHost, SshHostType};
use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{EngineDialect, EngineEnvironment, HostContext};
use cdc_runtime::runtimes::dialects::docker::{DockerDialect, read_socket_from_context};
use cdc_runtime::runtimes::profiles::shared::SshProfile;
use cdc_runtime::runtimes::transports::native::NativeTransport;
use cdc_runtime::runtimes::transports::ssh::SshTransport;

#[test]
fn docker_reads_the_first_contexts_endpoint() {
    // `context inspect` returns an ARRAY even for one context, and the original takes `[0]`.
    assert_eq!(
        read_socket_from_context(
            r#"[{"Endpoints":{"docker":{"Host":"unix:///var/run/docker.sock"}}},
                {"Endpoints":{"docker":{"Host":"unix:///nope.sock"}}}]"#
        ),
        "/var/run/docker.sock"
    );
}

#[test]
fn docker_reads_only_its_own_variable() {
    let both = EngineEnvironment {
        podman_host: Some("unix:///podman.sock".to_string()),
        docker_host: Some("unix:///docker.sock".to_string()),
    };
    assert_eq!(DockerDialect.native_uri_seed(&both), "unix:///docker.sock");
}

#[tokio::test]
async fn output_from_a_failed_context_read_is_not_parsed() {
    // A non-zero exit is not "no output" — `docker context inspect` can print a usable-looking body
    // and still fail, and reading it anyway would adopt an endpoint the command disowned.
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"context") {
            return CommandExecutionResult {
                code: 1,
                stdout: r#"[{"Endpoints":{"docker":{"Host":"unix:///run/stale.sock"}}}]"#
                    .to_string(),
                stderr: "context inspect failed".to_string(),
            };
        }
        if argv.contains(&"printenv") {
            return CommandExecutionResult::ok("unix:///run/from-env.sock\n");
        }
        CommandExecutionResult::ok("")
    });
    let host = unit_host(
        "host.default.docker.remote",
        Box::new(SshTransport),
        Box::new(DockerDialect),
        Box::new(SshProfile::DOCKER),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/run/from-env.sock",
        "the failed command's stdout is discarded and the fallback answers instead"
    );
}

#[tokio::test]
async fn a_scoped_docker_falls_back_to_the_guests_docker_host() {
    // The fallback the oracle wrote and then discarded with `|| ""`. Inside a distribution the
    // context can be unreadable while `DOCKER_HOST` still names a live socket, and that is the only
    // source left — the alternative is an unresolved api on a connection that would have worked.
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"context") {
            return CommandExecutionResult::failed(1, "context not found");
        }
        if argv.contains(&"printenv") {
            return CommandExecutionResult::ok("unix:///var/run/docker.sock\n");
        }
        CommandExecutionResult::ok("")
    });
    let log = command.log();
    let host = unit_host(
        "host.default.docker.remote",
        Box::new(SshTransport),
        Box::new(DockerDialect),
        Box::new(SshProfile::DOCKER),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/var/run/docker.sock",
        "normalised, because this method's contract is a scheme-stripped path"
    );
    assert!(
        log.lock()
            .expect("asked")
            .argv
            .iter()
            .any(|argv| argv.contains(&"printenv".to_string())),
        "the guest was actually asked"
    );
}

#[tokio::test]
async fn a_context_that_answers_is_never_second_guessed_by_the_environment() {
    // The order matters: `DOCKER_HOST` inside a guest is frequently stale, so it is a FALLBACK and
    // never an override. A context that answered is the engine's own word.
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"context") {
            return CommandExecutionResult::ok(
                r#"[{"Endpoints":{"docker":{"Host":"unix:///run/from-context.sock"}}}]"#,
            );
        }
        if argv.contains(&"printenv") {
            panic!("the environment was consulted despite a good context: {argv:?}");
        }
        CommandExecutionResult::ok("")
    });
    let host = unit_host(
        "host.default.docker.remote",
        Box::new(SshTransport),
        Box::new(DockerDialect),
        Box::new(SshProfile::DOCKER),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        "/run/from-context.sock"
    );
}

#[tokio::test]
async fn an_unscoped_docker_pays_nothing_for_the_fallback() {
    // `scope_environment_variable` refuses an unscoped host without running anything, so the second
    // source costs `docker.native` and Docker Desktop exactly one function call and no process.
    let command = FakeCommand::answering(|argv| {
        assert!(
            !argv.contains(&"printenv"),
            "an unscoped host read the guest environment it does not have: {argv:?}"
        );
        CommandExecutionResult::failed(1, "no context")
    });
    let host = unit_host(
        "host.manual.docker.native",
        Box::new(NativeTransport),
        Box::new(DockerDialect),
        Box::new(cdc_runtime::runtimes::profiles::docker::DockerNativeProfile),
        OperatingSystem::Linux,
        command,
    );

    assert_eq!(
        host.dialect()
            .read_engine_socket(&host, &unit_settings())
            .await,
        ""
    );
}

#[test]
fn docker_bridges_a_remote_endpoint_with_its_own_dial_stdio() {
    // The only way to reach a Windows remote: its endpoint is a named pipe, which `ssh -NL` cannot
    // forward at all.
    assert_eq!(DockerDialect.dial_stdio_program(), Some("docker"));
}

#[test]
fn a_pinned_connection_carries_the_context_flag_and_an_unpinned_one_carries_nothing() {
    let mut settings = unit_settings();
    assert_eq!(
        DockerDialect.target_args(&settings),
        Vec::<String>::new(),
        "every connection stored before pinning existed keeps the CLI's current context"
    );
    settings.context = Some("desktop-linux".to_string());
    assert_eq!(
        DockerDialect.target_args(&settings),
        vec!["--context".to_string(), "desktop-linux".to_string()]
    );
}

#[tokio::test]
async fn the_pin_reaches_the_socket_read_without_that_read_knowing_about_it() {
    // The whole point of applying it in `run_engine_command`: `read_engine_socket` is unchanged and
    // still asks the same question, and the answer is now about the context the connection MEANS.
    let command = FakeCommand::answering(|argv| {
        if argv.contains(&"context") && argv.contains(&"inspect") {
            // The fake answers the same body whatever is asked; what is asserted is the ARGV.
            return CommandExecutionResult::ok(
                r#"[{"Endpoints":{"docker":{"Host":"unix:///run/pinned.sock"}}}]"#,
            );
        }
        CommandExecutionResult::ok("")
    });
    let log = command.log();
    let host = unit_host(
        "host.default.docker.virtualized.vendor",
        Box::new(NativeTransport),
        Box::new(DockerDialect),
        Box::new(cdc_runtime::runtimes::profiles::docker::DockerVendorProfile),
        OperatingSystem::Darwin,
        command,
    );
    let mut settings = unit_settings();
    settings.context = Some("desktop-linux".to_string());

    assert_eq!(
        host.dialect().read_engine_socket(&host, &settings).await,
        "/run/pinned.sock"
    );
    // **The WHOLE argv, and the flag's POSITION is the assertion.** `--context` is a global flag:
    // after the subcommand it belongs to `context inspect` and retargets nothing. The launcher is
    // argv[0] and comes from the shared fixture's program, which is what makes it read `podman` in a
    // docker test — what is under test here is the composition, not the binary.
    let asked = log.lock().expect("asked").argv.clone();
    assert_eq!(
        asked,
        vec![vec![
            "/usr/bin/podman".to_string(),
            "--context".to_string(),
            "desktop-linux".to_string(),
            "context".to_string(),
            "inspect".to_string(),
            "--format".to_string(),
            "json".to_string(),
        ]]
    );
}

#[tokio::test]
async fn the_context_list_is_read_and_a_failed_listing_is_no_contexts() {
    // Two answers from one command, because the rule is which of them is parsed. A listing that
    // FAILED must not be read: nothing about a connection depends on it succeeding, and adopting the
    // body of a command that disowned it is how a stale store becomes the offer list.
    const LISTING: &str = "{\"Name\":\"colima\",\"DockerEndpoint\":\"unix:///c.sock\"}\n{\"Name\":\"default\",\"DockerEndpoint\":\"unix:///d.sock\",\"Current\":true}";
    // Two `fn` pointers rather than one closure over `code`: `FakeCommand::answering` takes a
    // function pointer, which cannot capture.
    /// One scripted answer and how many contexts it should yield.
    type Answer = (fn(&[&str]) -> CommandExecutionResult, usize);
    let answers: [Answer; 2] = [
        (|_| CommandExecutionResult::ok(LISTING), 2),
        (
            |_| CommandExecutionResult {
                code: 1,
                stdout: LISTING.to_string(),
                stderr: "cannot read the context store".to_string(),
            },
            0,
        ),
    ];
    for (respond, expected) in answers {
        let command = FakeCommand::answering(respond);
        let log = command.log();
        let host = unit_host(
            "host.default.docker.native",
            Box::new(NativeTransport),
            Box::new(DockerDialect),
            Box::new(cdc_runtime::runtimes::profiles::docker::DockerNativeProfile),
            OperatingSystem::Linux,
            command,
        );
        let listed = host
            .dialect()
            .list_contexts(&host, &unit_settings())
            .await
            .expect("a listing never refuses");
        assert_eq!(listed.len(), expected);
        assert_eq!(
            log.lock().expect("asked").argv,
            vec![vec![
                "/usr/bin/podman".to_string(),
                "context".to_string(),
                "ls".to_string(),
                "--format".to_string(),
                "json".to_string()
            ]]
        );
    }
}

#[tokio::test]
async fn listing_contexts_is_never_pinned_because_the_pin_would_decide_the_answer() {
    // **The one docker command here that must NOT carry `--context`, and the live screen is what
    // caught it.** `context ls` reads the machine's context STORE and dials no endpoint, so the flag
    // changes only which row comes back marked `Current`. Verified against the real CLI on a Mac whose
    // selection was `lima-ubuntu-vm`: `docker --context desktop-linux context ls` reported
    // `desktop-linux` as current while `docker context show` still said `lima-ubuntu-vm`.
    //
    // So a pinned listing agrees with the pin by construction, and the `current` a client renders —
    // "what this connection would follow if it did not pin" — becomes the pin itself. The contexts
    // screen showed `pinned · current` on the wrong row and nothing on the right one.
    let command = FakeCommand::answering(|_| CommandExecutionResult::ok(""));
    let log = command.log();
    let host = unit_host(
        "host.default.docker.native",
        Box::new(NativeTransport),
        Box::new(DockerDialect),
        Box::new(cdc_runtime::runtimes::profiles::docker::DockerNativeProfile),
        OperatingSystem::Linux,
        command,
    );
    let mut settings = unit_settings();
    settings.context = Some("colima".to_string());

    let _ = host.dialect().list_contexts(&host, &settings).await;
    assert_eq!(
        log.lock().expect("asked").argv,
        vec![vec![
            "/usr/bin/podman".to_string(),
            "context".to_string(),
            "ls".to_string(),
            "--format".to_string(),
            "json".to_string()
        ]],
        "the pin is absent even though this connection has one"
    );
}
