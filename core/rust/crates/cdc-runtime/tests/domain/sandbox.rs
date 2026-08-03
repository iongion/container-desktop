//! `domain/sandbox.rs` — the flatpak path rule, which the original applies in two places.

use cdc_runtime::domain::sandbox::host_path;

#[test]
fn a_process_that_is_not_sandboxed_sees_every_path_as_it_is() {
    for path in [
        "/run/user/1000/podman/podman.sock",
        "/var/run/docker.sock",
        "",
    ] {
        assert_eq!(host_path(path, false), path);
    }
}

#[test]
fn run_user_is_reached_under_var_and_everything_else_under_the_host_prefix() {
    // The original's own two branches. Getting them the wrong way round composes a path that exists
    // in neither namespace, so the connection resolves an address nothing binds — and the failure
    // reads as an engine that is down.
    assert_eq!(
        host_path("/run/user/1000/podman/podman.sock", true),
        "/var/run/user/1000/podman/podman.sock"
    );
    assert_eq!(
        host_path("/var/run/docker.sock", true),
        "/var/run/host/var/run/docker.sock"
    );
    assert_eq!(
        host_path("/run/docker.sock", true),
        "/var/run/host/run/docker.sock"
    );
}

#[test]
fn the_run_user_branch_matches_the_directory_and_not_a_name_that_merely_starts_with_it() {
    // `/run/user-data` is not inside `/run/user`, and treating it as such would send it to the wrong
    // prefix. The boundary is the separator.
    assert_eq!(host_path("/run/user", true), "/var/run/user");
    assert_eq!(
        host_path("/run/userland/sock", true),
        "/var/run/host/run/userland/sock"
    );
}

#[test]
fn nothing_is_prefixed_onto_a_path_that_is_not_the_hosts() {
    // An empty path is an unresolved address, and a relative one is this process's own. Prefixing
    // either composes something that looks like an address and is not one.
    assert_eq!(host_path("", true), "");
    assert_eq!(
        host_path("relative/socket.sock", true),
        "relative/socket.sock"
    );
}
