//! `runtimes/dialects/docker_contexts.rs` — reading `docker context ls`.
//!
//! The original never ran this command, so every rule here was settled by running the real CLI
//! (Docker 29.7.1, macOS, a store with five contexts) rather than read off the oracle — see
//! the design's table. The two that cost something if guessed: the output is NDJSON rather than an
//! array, and it carries `DockerEndpoint` where `context inspect` carries `Endpoints.docker.Host`.

use cdc_runtime::domain::types::engine::EngineContext;
use cdc_runtime::runtimes::dialects::docker_contexts::{
    CONTEXT_LIST_ARGS, context_target_args, parse_context_list,
};

/// One line of what the real CLI printed, verbatim.
const REAL_OUTPUT: &str = r#"{"Current":false,"Description":"colima","DockerEndpoint":"unix:///Users/iongion/.colima/default/docker.sock","Error":"","Name":"colima"}
{"Current":false,"Description":"Current DOCKER_HOST based configuration","DockerEndpoint":"unix:///var/run/docker.sock","Error":"","Name":"default"}
{"Current":false,"Description":"Docker Desktop","DockerEndpoint":"unix:///Users/iongion/.docker/run/docker.sock","Error":"","Name":"desktop-linux"}
{"Current":true,"Description":"","DockerEndpoint":"unix:///Users/iongion/.lima/ubuntu-vm/sock/docker.sock","Error":"","Name":"lima-ubuntu-vm"}
{"Current":false,"Description":"Podman","DockerEndpoint":"unix:///var/folders/zn/4gwlf49j2wd2wps14tplzf280000gn/T/podman/podman-machine-default-api.sock","Error":"","Name":"podman"}"#;

#[test]
fn the_list_is_ndjson_and_every_field_is_read() {
    let contexts = parse_context_list(REAL_OUTPUT);
    assert_eq!(contexts.len(), 5);
    assert_eq!(
        contexts[2],
        EngineContext {
            name: "desktop-linux".to_string(),
            endpoint: "unix:///Users/iongion/.docker/run/docker.sock".to_string(),
            description: "Docker Desktop".to_string(),
            current: false,
            error: String::new(),
        }
    );
    // Exactly one is current, and it is the one the CLI marked — not the first, and not the one
    // whose name happens to match an engine.
    let current: Vec<&str> = contexts
        .iter()
        .filter(|it| it.current)
        .map(|it| it.name.as_str())
        .collect();
    assert_eq!(current, vec!["lima-ubuntu-vm"]);
}

#[test]
fn the_endpoint_is_kept_verbatim_including_its_scheme() {
    // NOT normalised here. `read_engine_socket` strips the scheme because its contract is a path;
    // this is a LIST for a person to choose from, and `unix://` vs `npipe://` vs `tcp://` is the
    // difference between two entries that would otherwise read identically.
    let contexts = parse_context_list(
        r#"{"Name":"win","DockerEndpoint":"npipe:////./pipe/dockerDesktopLinuxEngine","Current":true,"Description":"","Error":""}"#,
    );
    assert_eq!(
        contexts[0].endpoint,
        "npipe:////./pipe/dockerDesktopLinuxEngine"
    );
}

#[test]
fn a_line_that_will_not_parse_costs_only_that_line() {
    // Per-LINE rather than all-or-nothing, and the difference is observable: docker writes its
    // errors to stderr, so a line here that will not parse is one unreadable entry — hiding the
    // other four would strand every working context behind it.
    let contexts = parse_context_list(
        "{\"Name\":\"a\",\"DockerEndpoint\":\"unix:///a.sock\"}\nnot json at all\n\n{\"Name\":\"b\",\"DockerEndpoint\":\"unix:///b.sock\"}\n",
    );
    assert_eq!(
        contexts
            .iter()
            .map(|it| it.name.as_str())
            .collect::<Vec<_>>(),
        vec!["a", "b"]
    );
}

#[test]
fn nothing_to_read_is_no_contexts_rather_than_a_failure() {
    // What a docker with an empty store, and a docker too old for `--format json`, both leave.
    for stdout in ["", "   \n \n", "[]"] {
        assert_eq!(parse_context_list(stdout), Vec::new(), "{stdout:?}");
    }
}

#[test]
fn every_field_defaults_so_an_older_docker_is_still_read() {
    // The same rule the podman connection list already holds to: a field a CLI does not emit must
    // read as its absence, never as a parse failure that hides the entry.
    assert_eq!(
        parse_context_list(r#"{"Name":"bare"}"#),
        vec![EngineContext {
            name: "bare".to_string(),
            endpoint: String::new(),
            description: String::new(),
            current: false,
            error: String::new(),
        }]
    );
}

#[test]
fn the_list_argv_is_the_one_the_parser_reads() {
    assert_eq!(CONTEXT_LIST_ARGS, ["context", "ls", "--format", "json"]);
}

#[test]
fn a_connection_that_names_no_context_adds_no_flag() {
    // The default, and every connection stored before pinning existed: the CLI's current context,
    // unchanged.
    assert_eq!(context_target_args(None), Vec::<String>::new());
    assert_eq!(context_target_args(Some("")), Vec::<String>::new());
    assert_eq!(context_target_args(Some("   ")), Vec::<String>::new());
}

#[test]
fn a_named_context_becomes_the_global_flag() {
    // GLOBAL — it precedes the subcommand, which is what makes one flag retarget `context inspect`
    // and `system dial-stdio` alike. A trailing flag would be the subcommand's and would not.
    assert_eq!(
        context_target_args(Some("desktop-linux")),
        vec!["--context".to_string(), "desktop-linux".to_string()]
    );
    // Trimmed, because a name that arrived with whitespace is the same name and docker would not
    // find it.
    assert_eq!(
        context_target_args(Some("  desktop-linux  ")),
        vec!["--context".to_string(), "desktop-linux".to_string()]
    );
}
