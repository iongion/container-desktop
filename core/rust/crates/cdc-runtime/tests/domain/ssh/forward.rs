//! The local address an SSH forward binds.
//!
//! The expected hashes are the ORACLE's — produced by running `Application.ts:shortStableHash` under
//! node — not this implementation's own output. A hash pinned to what the port happens to compute
//! proves the port is stable, which is not the property that matters: the desktop app derives the
//! same filename for the same connection, and if the two disagree they bind different sockets and
//! the failure looks like an unrelated connection error.

use cdc_runtime::domain::ssh::forward::{
    is_named_pipe, local_forward_address, short_stable_hash, windows_pipe_name, windows_pipe_path,
};
use cdc_runtime::domain::types::os::OperatingSystem;

const USER_DATA: &str = "/home/me/.local/share/container-desktop";

#[test]
fn the_hash_matches_the_oracle_for_a_real_connection_id() {
    assert_eq!(
        short_stable_hash("host.4f2c1e90-8b7a-4d2e-9a11-0c3f6b8e5d47.docker.remote"),
        "8600bf43"
    );
    assert_eq!(
        short_stable_hash("engine.default.podman.remote"),
        "ecccf231"
    );
}

#[test]
fn the_hash_of_nothing_is_the_fnv_offset_basis() {
    // The empty input is what proves the seed is the seed: a mutant that starts from 0 still hashes
    // every non-empty string to something, just not to this.
    assert_eq!(short_stable_hash(""), "811c9dc5");
    assert_eq!(short_stable_hash("a"), "e40c292c");
}

#[test]
fn the_hash_reads_utf16_code_units_exactly_as_the_oracle_does() {
    // `charCodeAt` yields UTF-16 code units, and a connection id can be named by a human. Hashing
    // this as UTF-8 bytes produces a different, entirely plausible-looking answer.
    assert_eq!(short_stable_hash("ünïcode-ід"), "dfb63c8a");
}

#[test]
fn the_hash_is_always_eight_hexadecimal_digits() {
    // The padding is load-bearing: an unpadded hash makes the socket filename vary in length, and
    // its length is the only reason the hash exists.
    assert_eq!(short_stable_hash("host.9.podman.remote"), "0dc9b697");
}

#[test]
fn a_posix_forward_binds_a_hashed_socket_beside_the_user_data() {
    // The exact filename is retained verbatim from the shipping app, including the `cdt-` prefix
    // that predates the `cdc-` crate naming.
    assert_eq!(
        local_forward_address(
            OperatingSystem::Linux,
            "host.4f2c1e90-8b7a-4d2e-9a11-0c3f6b8e5d47.docker.remote",
            USER_DATA
        ),
        "/home/me/.local/share/container-desktop/cdt-ssh-8600bf43.sock"
    );
}

#[test]
fn a_macos_forward_is_the_same_socket_beside_a_different_user_data() {
    assert_eq!(
        local_forward_address(
            OperatingSystem::Darwin,
            "engine.default.podman.remote",
            "/Users/me/Library/Application Support/container-desktop"
        ),
        "/Users/me/Library/Application Support/container-desktop/cdt-ssh-ecccf231.sock"
    );
}

#[test]
fn a_windows_forward_is_a_named_pipe_carrying_the_whole_id() {
    // A pipe name has no length cap, so it keeps the readable id — the hash exists only for the
    // ~104-byte Unix-socket path limit.
    assert_eq!(
        local_forward_address(
            OperatingSystem::WindowsNt,
            "host.4f2c1e90-8b7a-4d2e-9a11-0c3f6b8e5d47.docker.remote",
            USER_DATA
        ),
        "\\\\.\\pipe\\container-desktop-ssh-relay-host.4f2c1e90-8b7a-4d2e-9a11-0c3f6b8e5d47.docker.remote"
    );
}

#[test]
fn an_unknown_os_is_treated_as_posix() {
    // `os.type()` answers `unknown` on a platform nobody has classified; a Unix socket is the safe
    // reading, and a pipe path on a POSIX host would be a filename with backslashes in it.
    assert_eq!(
        local_forward_address(
            OperatingSystem::Unknown,
            "engine.default.podman.remote",
            "/tmp"
        ),
        "/tmp/cdt-ssh-ecccf231.sock"
    );
}

#[test]
fn a_pipe_path_is_the_relay_prefix_and_the_key() {
    assert_eq!(
        windows_pipe_path("engine.default.podman.remote"),
        "\\\\.\\pipe\\container-desktop-ssh-relay-engine.default.podman.remote"
    );
}

#[test]
fn both_spellings_of_a_named_pipe_are_recognised_and_no_socket_path_is() {
    // What `ssh -NL` cannot bind. Both spellings reach an address field: the relay pipe this module
    // builds, and the `npipe://` form a user can write into the settings by hand — which is the same
    // rule `normalize_unix_socket_path` states from the other side, where an `npipe://` survives
    // scheme-stripping precisely because it is bridged rather than forwarded.
    for pipe in [
        windows_pipe_path("host.default.docker.remote"),
        "npipe:////./pipe/docker_engine".to_string(),
        "NPIPE:////./pipe/docker_engine".to_string(),
    ] {
        assert!(is_named_pipe(&pipe), "{pipe}");
    }
    for socket in [
        "/run/podman/podman.sock",
        "unix:///run/podman/podman.sock",
        "/home/me/.local/share/container-desktop/cdt-ssh-8600bf43.sock",
        "",
    ] {
        assert!(!is_named_pipe(socket), "{socket}");
    }
}

#[test]
fn a_pipe_name_is_read_only_from_an_address_that_really_is_a_pipe() {
    // The pairing is the point. `pipe_name` on its own reads the last segment after a `pipe`
    // separator, which is safe for `parse_podman_machine_named_pipe` because it has already filtered
    // its input to `npipe://` URIs — and wrong for a filesystem port, which is handed whatever a
    // settings file contains. `/home/me/pipe/socket` is the case that separates them: a real POSIX
    // path, with a directory that happens to be called `pipe`, and it is not a named pipe.
    for (address, expected) in [
        (r"\\.\pipe\docker_engine", Some("docker_engine")),
        (
            "npipe:////./pipe/podman-machine-default",
            Some("podman-machine-default"),
        ),
        (
            "//./pipe/dockerDesktopLinuxEngine/",
            Some("dockerDesktopLinuxEngine"),
        ),
        (r"\\?\pipe\docker_engine", Some("docker_engine")),
        ("/home/me/pipe/socket", None),
        ("/run/podman/podman.sock", None),
        // A pipe address with no name left to read.
        (r"\\.\pipe\", None),
        ("", None),
    ] {
        assert_eq!(windows_pipe_name(address), expected, "{address}");
    }
}
