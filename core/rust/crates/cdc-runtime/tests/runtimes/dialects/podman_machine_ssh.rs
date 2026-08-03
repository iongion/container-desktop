//! `runtimes/dialects/podman-machine-ssh.ts` — the nested hop into a podman MACHINE.
//!
//! A machine's API socket is inside its VM, and podman's own remote client will not dial it from a
//! non-interactive session — its bundled Go SSH client never offers the publickey the machine identity
//! is. So the bridge is one more OpenSSH hop, and the argv IS the observable behaviour: an option in
//! the wrong place produces a command that runs and reaches a different engine, which is a thing to
//! assert here rather than discover against a live machine.

use cdc_runtime::runtimes::dialects::podman_machine_connections::PodmanSystemConnection;
use cdc_runtime::runtimes::dialects::podman_machine_ssh::{
    PodmanMachineSsh, dial_stdio_args, machine_ssh_connection,
};

/// The identity podman writes on a Windows host — a profile path, with the spaces that makes possible.
const WINDOWS_IDENTITY: &str = r"C:\Users\istoica\.local\share\containers\podman\machine\machine";

fn machine(name: &str, default: bool, uri: &str, identity: &str) -> PodmanSystemConnection {
    PodmanSystemConnection {
        name: name.to_string(),
        uri: uri.to_string(),
        identity: identity.to_string(),
        is_machine: true,
        default,
    }
}

/// What `podman system connection list --format json` reports on a Windows host with a running
/// machine, captured live: podman marks the ROOTFUL connection `Default` and this app targets
/// rootless.
fn windows_machine_connections() -> Vec<PodmanSystemConnection> {
    vec![
        machine(
            "podman-machine-default",
            false,
            "ssh://user@127.0.0.1:56515/run/user/1000/podman/podman.sock",
            WINDOWS_IDENTITY,
        ),
        machine(
            "podman-machine-default-root",
            true,
            "ssh://root@127.0.0.1:56515/run/podman/podman.sock",
            WINDOWS_IDENTITY,
        ),
    ]
}

#[test]
fn the_rootless_machine_is_chosen_over_the_rootful_one_podman_calls_default() {
    // The whole reason this goes through `prefer_rootless_machine_connection` rather than reading
    // `Default`: podman marks the `-root` connection default on some WSL machines, and bridging to it
    // would reach the rootful engine — a different set of containers from the one the app targets.
    assert_eq!(
        machine_ssh_connection(&windows_machine_connections()),
        Some(PodmanMachineSsh {
            user: "user".to_string(),
            host: "127.0.0.1".to_string(),
            port: 56515,
            socket: "/run/user/1000/podman/podman.sock".to_string(),
            identity: WINDOWS_IDENTITY.to_string(),
        })
    );
}

#[test]
fn a_remote_that_is_not_a_machine_is_not_bridged() {
    // A native remote podman is a plain socket on the remote host, which the outer `ssh -NL` forward
    // reaches directly. Answering a bridge for it would nest a second hop into a VM that is not there.
    let mut native = machine(
        "remote-linux",
        true,
        "ssh://podman@build-box:22/run/user/1000/podman/podman.sock",
        "/home/me/.ssh/id_ed25519",
    );
    native.is_machine = false;

    assert_eq!(machine_ssh_connection(&[native]), None);
}

#[test]
fn a_machine_with_no_identity_is_not_bridged() {
    // The identity is the whole point of the nested hop — it is the key podman's own client will not
    // load. Without one, `ssh -i ""` would fall back to the agent and reach the machine only by
    // accident, so an entry that carries none is not a machine this can bridge.
    assert_eq!(
        machine_ssh_connection(&[machine(
            "podman-machine-default",
            true,
            "ssh://user@127.0.0.1:56515/run/user/1000/podman/podman.sock",
            "",
        )]),
        None
    );
}

#[test]
fn a_machine_with_no_uri_and_a_uri_that_is_not_ssh_are_both_refused() {
    // Both are the original's regexp failing, and both must answer "no bridge" rather than a
    // connection with an empty host: `ssh -p 22 podman system dial-stdio` names no host at all and
    // would be read by ssh as a request to run `-p` on a machine called `22`.
    for uri in [
        "",
        "tcp://127.0.0.1:2375",
        "ssh://",
        "ssh:///run/podman.sock",
        "ssh://user@127.0.0.1:not-a-port/run/podman.sock",
    ] {
        assert_eq!(
            machine_ssh_connection(&[machine(
                "podman-machine-default",
                true,
                uri,
                WINDOWS_IDENTITY
            )]),
            None,
            "{uri}"
        );
    }
    assert_eq!(
        machine_ssh_connection(&[]),
        None,
        "and nothing to choose from"
    );
}

#[test]
fn a_uri_that_names_no_port_or_no_user_still_resolves() {
    // `(?::(\d+))?` and `(?:([^@]+)@)?` are both optional in the original, and 22 is `ssh`'s own
    // default rather than a number this module picked.
    assert_eq!(
        machine_ssh_connection(&[machine(
            "podman-machine-default",
            true,
            "ssh://127.0.0.1/run/podman/podman.sock",
            WINDOWS_IDENTITY,
        )]),
        Some(PodmanMachineSsh {
            user: String::new(),
            host: "127.0.0.1".to_string(),
            port: cdc_runtime::domain::ssh::args::DEFAULT_SSH_PORT,
            socket: "/run/podman/podman.sock".to_string(),
            identity: WINDOWS_IDENTITY.to_string(),
        })
    );
}

#[test]
fn the_nested_command_hops_into_the_machine_and_runs_the_machines_own_dial_stdio() {
    // Asserted WHOLE. Every option is a fixed defect rather than a preference, and the two that look
    // like laxity are the load-bearing ones: the machine's host key rotates on every recreation and
    // lives only in podman's own store, so `StrictHostKeyChecking=no` is the alternative to failing on
    // every rebuild; `BatchMode=yes` is what stops a prompt hanging the bridge forever, since nothing
    // is attached to a stdio channel to answer one.
    assert_eq!(
        dial_stdio_args(&PodmanMachineSsh {
            user: "root".to_string(),
            host: "127.0.0.1".to_string(),
            port: 56515,
            socket: "/run/podman/podman.sock".to_string(),
            identity: WINDOWS_IDENTITY.to_string(),
        }),
        vec![
            "ssh",
            "-i",
            // QUOTED, and the quotes are literal argv characters rather than shell syntax: this
            // command is handed to the REMOTE's shell by the outer `ssh`, and on a Windows remote that
            // is cmd.exe, where an unquoted profile path with a space becomes two arguments.
            &format!("\"{WINDOWS_IDENTITY}\""),
            "-p",
            "56515",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "BatchMode=yes",
            "root@127.0.0.1",
            // The engine INSIDE the VM, so the bare name and never `settings.program.path` — that path
            // is the remote HOST's (`C:\...\podman.exe` on Windows), which names nothing in a Linux VM.
            "podman",
            "system",
            "dial-stdio",
        ]
    );
}

#[test]
fn a_machine_that_named_no_user_is_addressed_by_host_alone() {
    // `user@host` with an empty user is `@host`, which ssh reads as a request to log in as nobody.
    let argv = dial_stdio_args(&PodmanMachineSsh {
        user: String::new(),
        host: "127.0.0.1".to_string(),
        port: 22,
        socket: "/run/podman/podman.sock".to_string(),
        identity: WINDOWS_IDENTITY.to_string(),
    });

    assert_eq!(
        argv[argv.len() - 4],
        "127.0.0.1",
        "the target is the host on its own"
    );
}
