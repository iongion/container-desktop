//! The stdio BRIDGE a remote offers — `dial-stdio`, and the nesting an `ssh` into a machine needs.
//!
//! Split from the parent for the 620-line cap; the fixtures stay there and are reached with
//! `super::`.

use super::*;

/// The base options every `ssh` invocation carries — pinned in `domain/ssh/args.rs`, and interpolated
/// here rather than re-pinned, because the subject below is the NESTING and not the base argv.
fn outer_ssh_prefix() -> Vec<String> {
    [
        "ssh",
        "-oStrictHostKeyChecking=accept-new",
        "-oBatchMode=yes",
        &format!("-oConnectTimeout={SSH_CONNECT_TIMEOUT_SECONDS}"),
        "-oConnectionAttempts=1",
        "-i",
        "/home/tester/.ssh/id_rsa",
        "-p",
        "2222",
        "tester@192.168.122.5",
        "--",
    ]
    .map(str::to_string)
    .to_vec()
}

#[tokio::test]
async fn a_remote_podman_machine_is_reached_by_nesting_ssh_into_it() {
    // **The whole of how an SSH client reaches an engine inside a podman machine.** The machine binds
    // its socket in the VM, so the outer `ssh -NL` forward has nothing on the remote HOST to point at;
    // this argv reaches the engine with no forward at all, and it is what `dialStdioCommand` carries.
    //
    // Asserted WHOLE, both hops and the launcher included: it is handed to `Endpoint::Stdio` and
    // spawned verbatim, so `argv[0]` must be the program to run and the `--` must separate the outer
    // ssh's own options from a nested command that starts with one.
    let (host, _) = remote(OperatingSystem::Linux, true, |argv| {
        if argv.contains(&"connection") {
            return CommandExecutionResult::ok(MACHINE_CONNECTIONS);
        }
        CommandExecutionResult::ok("")
    });

    let mut expected = outer_ssh_prefix();
    expected.extend(
        [
            "ssh",
            "-i",
            "\"/home/tester/.local/share/containers/podman/machine/machine\"",
            "-p",
            "56515",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "BatchMode=yes",
            // The ROOTLESS machine, though podman marked the other one Default.
            "core@127.0.0.1",
            "podman",
            "system",
            "dial-stdio",
        ]
        .map(str::to_string),
    );
    assert_eq!(
        SshTransport
            .resolve_dial_stdio(&host, &unit_settings(), "/run/user/1000/podman/podman.sock")
            .await,
        expected
    );
}

/// The engine's own bridge, naming no socket: `<engine> system dial-stdio` dials whatever the
/// remote's own context says — unless the connection PINNED one, which is the case below.
fn plain_bridge(program: &str) -> Vec<String> {
    let mut expected = outer_ssh_prefix();
    expected.extend([program, "system", "dial-stdio"].map(str::to_string));
    expected
}

#[tokio::test]
async fn a_pinned_docker_remote_bridges_the_context_it_names_rather_than_the_remotes_current_one() {
    // **The far side is where this defect is invisible.** Detection reads the pinned context through
    // the same flag, so a bridge WITHOUT it would carry data to whatever `docker context use` last
    // selected on the remote — a connection reporting one engine's socket while talking to another's,
    // with nothing local able to show the difference.
    let command =
        FakeCommand::answering(|_| CommandExecutionResult::failed(125, "unknown command"));
    let host = unit_host(
        "host.default.docker.remote",
        Box::new(SshTransport),
        Box::new(cdc_runtime::runtimes::dialects::docker::DockerDialect),
        Box::new(SshProfile::DOCKER),
        OperatingSystem::Linux,
        command,
    )
    .with_scope(Some(ssh_scope()));
    // The shared fixture names podman; a docker remote runs `docker`, and `bridge_program` reads it
    // off the settings.
    let mut unpinned = unit_settings();
    unpinned.program.name = "docker".to_string();
    let mut settings = unpinned.clone();
    settings.context = Some("desktop-linux".to_string());

    let mut expected = outer_ssh_prefix();
    expected.extend(
        [
            "docker",
            "--context",
            "desktop-linux",
            "system",
            "dial-stdio",
        ]
        .map(str::to_string),
    );
    assert_eq!(
        SshTransport
            .resolve_dial_stdio(&host, &settings, "/var/run/docker.sock")
            .await,
        expected
    );
    // And unpinned, the same connection composes the bridge it always did — the flag is the only
    // difference, so nothing that does not pin changes.
    assert_eq!(
        SshTransport
            .resolve_dial_stdio(&host, &unpinned, "/var/run/docker.sock")
            .await,
        plain_bridge("docker")
    );
}

#[tokio::test]
async fn a_remote_with_no_machine_is_bridged_by_the_engines_own_dial_stdio() {
    // The other arm of `resolveDialStdioBridge`: `ssh -NL` is no longer the data plane for ANY podman
    // or docker remote. A forward reaches a unix socket; it cannot reach a Windows Docker remote at all.
    let (host, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok(
            r#"[{"Name":"remote-linux","URI":"ssh://podman@build-box:22/run/podman.sock",
                 "Identity":"/home/me/.ssh/id_ed25519","IsMachine":false,"Default":true}]"#,
        )
    });

    assert_eq!(
        SshTransport
            .resolve_dial_stdio(&host, &unit_settings(), "/run/podman.sock")
            .await,
        plain_bridge("podman")
    );
}

#[tokio::test]
async fn an_engine_that_cannot_list_connections_is_bridged_all_the_same() {
    // How DOCKER answers — no `system connection list` at all — and `podman.ts` falls through on a
    // failed listing too: it decides whether there is a MACHINE, never whether there is a bridge.
    let (host, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::failed(125, "unknown command")
    });

    assert_eq!(
        SshTransport
            .resolve_dial_stdio(&host, &unit_settings(), "/run/podman.sock")
            .await,
        plain_bridge("podman")
    );
}

#[tokio::test]
async fn an_engine_that_ships_no_dial_stdio_offers_no_bridge_and_asks_the_remote_nothing() {
    // Why the plain arm is a dialect question rather than an `else`. What the forward points at is
    // socktainer's socket, and a bridge would replace it with a command the remote refuses.
    let (host, log) = apple_remote(|_| CommandExecutionResult::ok(MACHINE_CONNECTIONS));

    assert!(
        SshTransport
            .resolve_dial_stdio(
                &host,
                &unit_settings(),
                "/Users/tester/.socktainer/container.sock"
            )
            .await
            .is_empty()
    );
    assert!(
        log.lock().expect("asked").argv.is_empty(),
        "the remote was asked nothing at all"
    );
}

#[tokio::test]
async fn an_engine_that_reported_no_socket_offers_no_bridge() {
    // `if (!socket) return undefined`, the whole of the oracle's guard. The socket is evidence and
    // never an argument: an engine that could not say where it listens has not answered at all.
    let (host, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::failed(125, "unknown command")
    });

    assert!(
        SshTransport
            .resolve_dial_stdio(&host, &unit_settings(), "")
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn the_bridge_names_the_program_as_configured_and_never_the_detected_path() {
    // `settings.program.name || "docker"`, and `docker.ts` says why: a bare name on the remote PATH
    // "avoids cmd.exe quoting a detected path". `program_launcher` prefers the detected path, which
    // on a Windows remote is the one value that must not go here.
    let (host, _) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::failed(125, "unknown command")
    });
    let mut named = unit_settings();
    named.program.name = "podman-remote".to_string();
    named.program.path = Some(r"C:\Program Files\RedHat\Podman\podman.exe".to_string());

    assert_eq!(
        SshTransport
            .resolve_dial_stdio(&host, &named, "/run/podman.sock")
            .await,
        plain_bridge("podman-remote")
    );

    // The `||` half: a connection that named no program takes the dialect's own answer.
    let mut unnamed = unit_settings();
    unnamed.program.name = String::new();
    assert_eq!(
        SshTransport
            .resolve_dial_stdio(&host, &unnamed, "/run/podman.sock")
            .await,
        plain_bridge("podman")
    );
}

#[tokio::test]
async fn an_unbound_scope_offers_no_bridge_rather_than_a_command_naming_no_host() {
    // The outer hop needs credentials, and without a scope there are none. `ssh -- podman system
    // dial-stdio` names no host: ssh would read the first remote word as the destination and try to
    // log into a machine called `podman`.
    let (host, _) = remote(OperatingSystem::Linux, false, |_| {
        CommandExecutionResult::ok(MACHINE_CONNECTIONS)
    });

    assert!(
        SshTransport
            .resolve_dial_stdio(&host, &unit_settings(), "/run/podman.sock")
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn the_forward_is_not_opened_when_a_bridge_already_reaches_the_engine() {
    // A bridge and a forward are two data planes for one engine, and the bridge outranks — which
    // `proxy::endpoint` has always said. Opening the forward anyway would spawn an `ssh -NL` at a
    // relay INSIDE the VM, which is a path the remote host does not have: the forward fails, and the
    // attempt fails with it, over a connection the bridge was about to reach perfectly well.
    let (host, log) = remote(OperatingSystem::Linux, true, |_| {
        CommandExecutionResult::ok("")
    });
    let mut settings = unit_settings();
    settings.api.connection.relay = "/run/user/1000/podman/podman.sock".to_string();
    settings.api.connection.dial_stdio_command = ["ssh", "--", "podman", "system", "dial-stdio"]
        .map(str::to_string)
        .to_vec();

    assert!(
        SshTransport
            .start_api(&host, &settings)
            .await
            .expect("a bridged connection has nothing to open")
    );
    assert!(
        log.lock().expect("asked").services.is_empty(),
        "nothing was spawned: the bridge is the data plane"
    );
}
