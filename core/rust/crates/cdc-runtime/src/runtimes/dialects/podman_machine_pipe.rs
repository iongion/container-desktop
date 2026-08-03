//! `runtimes/dialects/podman-machine-pipe.ts` — reaching a podman MACHINE natively on Windows.
//!
//! Newer podman exposes the machine's API as a Windows named pipe
//! (`npipe:////./pipe/podman-machine-default`) and lists it in `podman system connection list`. When it
//! is there, that pipe is dialable directly from a native Windows process — no relay, no SSH, no
//! `dial-stdio`. Older WSL-ssh machines expose only `ssh://` URIs, so there is no pipe and the caller
//! keeps its bridge path.
//!
//! The original's `isWindowsNamedPipe` is not ported here: it is the same predicate as
//! [`crate::domain::ssh::forward::is_named_pipe`], differing only in which spellings each accepts. The
//! union is what both callers need — a form neither recognises is the bug — so there is one function
//! and it lives where the forward's refusal already used it.

use crate::domain::ssh::forward::windows_named_pipe_path;
use crate::runtimes::dialects::podman_machine_connections::{
    PodmanSystemConnection, prefer_rootless_machine_connection,
};
use crate::runtimes::dialects::shared::strip_scheme;

/// The machine's Windows named-pipe path, when podman exposes one.
///
/// Prefers the ROOTLESS machine connection — never the rootful `-root` pipe, which the app does not
/// target — mirroring every other selection over this list.
pub fn parse_podman_machine_named_pipe(connections: &[PodmanSystemConnection]) -> Option<String> {
    let machines: Vec<PodmanSystemConnection> = connections
        .iter()
        .filter(|entry| entry.is_machine && strip_scheme(&entry.uri, "npipe://").is_some())
        .cloned()
        .collect();
    let chosen = prefer_rootless_machine_connection(&machines)?;
    Some(windows_named_pipe_path(pipe_name(&chosen.uri)?))
}

/// The pipe's own name out of any spelling of a pipe address — the last path segment, when what
/// precedes it is `pipe`.
///
/// `npipe:////./pipe/podman-machine-default`, `\\.\pipe\podman-machine-default` and a trailing
/// separator all answer the same name; anything else answers nothing, because a URI that is not a pipe
/// has no pipe name to take.
pub fn pipe_name(uri: &str) -> Option<&str> {
    let separators = |it: char| it == '/' || it == '\\';
    let mut segments = uri.trim().trim_end_matches(separators).rsplit(separators);
    let name = segments.next()?;
    let parent = segments.next()?;
    if name.is_empty() || !parent.eq_ignore_ascii_case("pipe") {
        return None;
    }
    Some(name)
}
