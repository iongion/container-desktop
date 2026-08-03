//! `docker context ls`, parsed once, and the flag that pins a connection to one.
//!
//! The counterpart of [`super::podman_machine_connections`] on the Docker side: one typed parse of a
//! list the engine prints, kept away from the call sites that would otherwise each ask the CLI
//! something slightly different. The original never ran this command — the rules below came from
//! running the real one, and the two that would have been guessed wrong are that the output is
//! NDJSON and that it names the endpoint `DockerEndpoint` where `context inspect` names it
//! `Endpoints.docker.Host`.

use crate::domain::types::engine::EngineContext;

/// The argv that produces what [`parse_context_list`] reads.
pub const CONTEXT_LIST_ARGS: [&str; 4] = ["context", "ls", "--format", "json"];

/// The contexts the CLI reported.
///
/// **One object per LINE.** A line that will not parse costs only that entry: docker writes its
/// errors to stderr, so an unreadable line here is one broken context and not a reason to hide the
/// working ones behind it.
pub fn parse_context_list(stdout: &str) -> Vec<EngineContext> {
    stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<EngineContext>(line.trim()).ok())
        .filter(|context| !context.name.is_empty())
        .collect()
}

/// The GLOBAL flag that points one command at a named context, or nothing when none is named.
///
/// Global rather than the subcommand's, which is what makes a single flag retarget the socket read
/// and `system dial-stdio` alike — `docker --context <name> <subcommand>`. It also beats
/// `DOCKER_HOST`, so a connection that pins is pinned whatever the environment says.
///
/// A name that is empty or blank is NO name: a connection carrying one has not chosen, and docker
/// would refuse a blank one rather than fall back.
pub fn context_target_args(context: Option<&str>) -> Vec<String> {
    let name = context.unwrap_or_default().trim();
    if name.is_empty() {
        return Vec::new();
    }
    vec!["--context".to_string(), name.to_string()]
}
