//! `runtimes/dialects/podman-machine-pipe.ts` — the Windows named pipe a machine serves.
//!
//! The `connection` fixture is COPIED from `podman_machine_connections.rs` rather than shared: these
//! are two source modules, and a fixture reaching across them would put this file's failures in that
//! file's blast radius.

use cdc_runtime::domain::ssh::forward::{is_named_pipe, windows_named_pipe_path};
use cdc_runtime::runtimes::dialects::podman_machine_connections::PodmanSystemConnection;
use cdc_runtime::runtimes::dialects::podman_machine_pipe::{
    parse_podman_machine_named_pipe, pipe_name,
};

fn connection(name: &str, is_machine: bool, default: bool, uri: &str) -> PodmanSystemConnection {
    PodmanSystemConnection {
        name: name.to_string(),
        uri: uri.to_string(),
        identity: String::new(),
        is_machine,
        default,
    }
}

#[test]
fn a_machines_native_windows_pipe_is_taken_from_the_connection_it_belongs_to() {
    // Newer podman lists the machine's API as a Windows named pipe, and that pipe is dialable directly
    // from a native Windows process — no relay, no SSH, no `dial-stdio`.
    let list = vec![
        connection(
            "podman-machine-default-root",
            true,
            true,
            "npipe:////./pipe/podman-machine-default-root",
        ),
        connection(
            "podman-machine-default",
            true,
            false,
            "npipe:////./pipe/podman-machine-default",
        ),
        connection("remote", false, false, "npipe:////./pipe/not-a-machine"),
    ];

    assert_eq!(
        parse_podman_machine_named_pipe(&list),
        Some(windows_named_pipe_path("podman-machine-default")),
        "the ROOTLESS machine's pipe, never the rootful one podman defaulted to"
    );

    // An older WSL-ssh machine exposes only `ssh://` — there is no pipe, so the caller keeps its
    // bridge path rather than being handed a pipe that does not exist.
    let ssh_only = vec![connection(
        "podman-machine-default",
        true,
        true,
        "ssh://core@127.0.0.1:56515/run/user/1000/podman/podman.sock",
    )];
    assert_eq!(parse_podman_machine_named_pipe(&ssh_only), None);
    assert_eq!(parse_podman_machine_named_pipe(&[]), None);

    // BOTH halves of the filter are required, and this is the case that proves it: a plain remote
    // connection can be served over a named pipe too, and it is not a machine. Taking it would point
    // a podman-machine host at somebody else's engine.
    let not_a_machine = vec![connection(
        "remote",
        false,
        true,
        "npipe:////./pipe/not-a-machine",
    )];
    assert_eq!(parse_podman_machine_named_pipe(&not_a_machine), None);
    // A pipe URI with nothing after `pipe/` names no pipe.
    assert_eq!(
        parse_podman_machine_named_pipe(&[connection("m", true, true, "npipe:////./pipe/")]),
        None
    );
}

#[test]
fn a_pipe_name_is_the_segment_after_pipe_in_any_spelling() {
    for uri in [
        "npipe:////./pipe/podman-machine-default",
        r"\\.\pipe\podman-machine-default",
        r"\\.\pipe\podman-machine-default\",
        "//./PIPE/podman-machine-default",
    ] {
        assert_eq!(pipe_name(uri), Some("podman-machine-default"), "{uri}");
    }
    for not_a_pipe in [
        "ssh://core@127.0.0.1:56515/run/podman.sock",
        "/run/podman/podman.sock",
        "pipe",
        "",
    ] {
        assert_eq!(pipe_name(not_a_pipe), None, "{not_a_pipe}");
    }
}

#[test]
fn every_spelling_of_a_windows_pipe_is_recognised_as_one() {
    // The union of the original's two predicates: `utils:isNamedPipe` knows the backslash form and the
    // `npipe://` scheme, `podman-machine-pipe.ts:isWindowsNamedPipe` also knows the forward-slash form
    // podman prints inside a URI and the `\\?\` device prefix. A form one of them missed is a pipe
    // treated as a socket — forwarded by `ssh -NL`, or overwritten by an in-VM path.
    for pipe in [
        r"\\.\pipe\podman-machine-default",
        "//./pipe/podman-machine-default",
        r"\\?\pipe\podman-machine-default",
        "//?/pipe/podman-machine-default",
        "npipe:////./pipe/docker_engine",
        "NPIPE:////./pipe/docker_engine",
    ] {
        assert!(is_named_pipe(pipe), "{pipe}");
    }
    for socket in [
        "/run/podman/podman.sock",
        "unix:///run/podman/podman.sock",
        r"\\.\pipefoo",
        "//./notpipe/x",
        "",
    ] {
        assert!(!is_named_pipe(socket), "{socket}");
    }
}
