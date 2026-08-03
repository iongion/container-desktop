//! `runtimes/dialects/shared.ts` — the socket-path rule every dialect goes through, and the scoped
//! reads that answer "where does the machine at the far end keep things".

use crate::domain::pathing::expand_home;
use crate::domain::types::connection::EngineConnectorSettings;
use crate::runtimes::composition::HostContext;

/// `HOME` — what a scoped read asks the guest for.
const HOME_VARIABLE: &str = "HOME";

/// What `uname -s` prints on a Mac.
const DARWIN_UNAME: &str = "Darwin";

/// Strip a `unix://` scheme; keep a `npipe://` verbatim; reject any other scheme.
///
/// `dialects/shared.ts:normalizeUnixSocketPath`. A named pipe cannot be `ssh -NL` forwarded but is
/// bridged over `dial-stdio`, so it must survive; `tcp://` and friends are not something this
/// codebase speaks and become empty rather than a path that will never open.
pub fn normalize_unix_socket_path(value: &str) -> String {
    let socket = value.trim();
    if socket.is_empty() {
        return String::new();
    }
    if let Some(stripped) = strip_scheme(socket, "unix://") {
        return stripped.to_string();
    }
    if strip_scheme(socket, "npipe://").is_some() {
        return socket.to_string();
    }
    if has_uri_scheme(socket) {
        return String::new();
    }
    socket.to_string()
}

/// The remainder after a case-insensitive scheme prefix, or `None` when it is not there.
///
/// Public because the SSH forward asks the same question of a remote address and answers it
/// differently (`ssh::args::forward_path`) — the rule is shared, the policy is not.
pub fn strip_scheme<'a>(value: &'a str, scheme: &str) -> Option<&'a str> {
    let prefix = value.get(..scheme.len())?;
    prefix
        .eq_ignore_ascii_case(scheme)
        .then(|| &value[scheme.len()..])
}

/// `dialects/shared.ts:readScopedHome` — the home directory of the machine the ENGINE runs on.
///
/// Empty for an unscoped host WITHOUT running anything, which is what lets every caller write the
/// scoped read first and fall back to this machine's home for free.
pub async fn read_scoped_home(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
) -> String {
    host.scope_environment_variable(HOME_VARIABLE, settings)
        .await
}

/// `dialects/shared.ts:isScopedMacOS` — whether the guest at the far end is a Mac.
///
/// **This is the capability question that replaces a host-type check.** The original asks
/// `host.HOST === PODMAN_REMOTE` first and only then runs this probe; a dialect here may never match
/// on host type, so the probe stands alone — and it selects exactly the same set, because every
/// other scope's guest is Linux by construction (a WSL distribution, a LIMA instance and a podman
/// machine are all Linux VMs). A Windows remote lands in `cmd.exe`, which has no `uname` at all, and
/// the failed probe answers `false`.
pub async fn is_scoped_macos(host: &dyn HostContext, settings: &EngineConnectorSettings) -> bool {
    let args = ["-s".to_string()];
    match host.run_scope_command("uname", &args, settings).await {
        Ok(output) => output.success() && output.stdout.trim() == DARWIN_UNAME,
        Err(_) => false,
    }
}

/// `dialects/shared.ts:expandScopedSocketPath` — resolve a `~` or `$HOME` against the GUEST's home.
///
/// The scoped home is read only when the path actually needs it, which is the original's order and
/// not an optimisation: an absolute socket path must not cost a round-trip, and a guest that cannot
/// answer `printenv HOME` still yields the path as written rather than nothing.
pub async fn expand_scoped_socket_path(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
    value: &str,
) -> String {
    let socket = normalize_unix_socket_path(value);
    if socket.is_empty() || (!socket.starts_with('~') && !socket.contains("$HOME")) {
        return socket;
    }
    let home = read_scoped_home(host, settings).await;
    if home.is_empty() {
        return socket;
    }
    expand_home(&socket, &home)
}

/// `<letters+>://`, the shape `URI_SCHEME_PATTERN` matches.
fn has_uri_scheme(value: &str) -> bool {
    match value.split_once("://") {
        Some((scheme, _)) => {
            !scheme.is_empty()
                && scheme
                    .chars()
                    .all(|it| it.is_ascii_alphanumeric() || it == '+')
        }
        None => false,
    }
}
