//! `runtimes/dialects/shared.ts` — the scheme rules every dialect's socket read goes through.

use cdc_runtime::runtimes::dialects::docker::read_socket_from_context;
use cdc_runtime::runtimes::dialects::podman::read_socket_from_info;
use cdc_runtime::runtimes::dialects::shared::normalize_unix_socket_path;

#[test]
fn output_that_cannot_be_parsed_is_an_empty_socket_rather_than_a_panic() {
    // The original's `catch` leaves it empty: a detection failure, not a crash. Every shape that can
    // actually arrive — a warning banner, valid JSON without the key, an empty string.
    for stdout in ["", "WARN: something", "{}", "[]", r#"{"host":{}}"#] {
        assert_eq!(read_socket_from_info(stdout), "", "podman: {stdout:?}");
        assert_eq!(read_socket_from_context(stdout), "", "docker: {stdout:?}");
    }
}

#[test]
fn a_named_pipe_survives_normalisation_and_an_unknown_scheme_does_not() {
    // A pipe cannot be `ssh -NL` forwarded but IS bridged over `dial-stdio`, so it must survive.
    // `tcp://` is not something this codebase speaks, and an empty answer beats a path that will
    // never open.
    assert_eq!(
        normalize_unix_socket_path("npipe:////./pipe/docker_engine"),
        "npipe:////./pipe/docker_engine"
    );
    assert_eq!(normalize_unix_socket_path("tcp://127.0.0.1:2375"), "");
    assert_eq!(
        normalize_unix_socket_path("  /run/podman.sock  "),
        "/run/podman.sock"
    );
    assert_eq!(
        normalize_unix_socket_path("UNIX:///run/p.sock"),
        "/run/p.sock"
    );
    assert_eq!(
        normalize_unix_socket_path("git+ssh://host/x"),
        "",
        "`+` is part of a scheme name, so this IS a uri — and one nothing here speaks"
    );
    assert_eq!(
        normalize_unix_socket_path("://weird"),
        "://weird",
        "and a `://` with no scheme in front of it is not a uri at all, so it travels on as the \
         path it looks like and the engine is left to refuse it"
    );
}
