//! Where a path lands when the process is inside a flatpak sandbox.
//!
//! A sandboxed process sees the host's filesystem through a prefix, so a socket the ENGINE bound at
//! `/run/user/1000/podman/podman.sock` is not at that path from in here. The original applies the
//! same two rules in two places — `transports/native.ts:startApi`, which creates the socket's base
//! directory, and `Api.clients.ts:getApiConfig`, which dials it — and this is that rule, once.
//!
//! **`is_flatpak` is host knowledge and arrives as DATA**, exactly like `home` and `arch`: the
//! original's own detection is "Linux, and either `FLATPAK_ID` is set or `/.flatpak-info` exists",
//! which is two environment reads and no new capability. This was recorded as blocked on a
//! `Platform.isFlatpak()` the capabilities do not expose; that was wrong twice over — nothing new is
//! needed, and the app does not ship a flatpak yet either (its packaging config omits it
//! deliberately). It is ported because the oracle has it and a target that arrives later must not
//! find a hole.

/// The prefix a sandboxed process reaches the host's `/run/user/...` through.
///
/// `/run/user` is bind-mounted under `/var` rather than under the general host prefix — the
/// original's own branch, and the reason this is two rules and not one.
const RUN_USER: &str = "/run/user";

/// Where everything else on the host filesystem appears.
const HOST_PREFIX: &str = "/var/run/host";

/// The path as this process must spell it — unchanged when not sandboxed.
///
/// Pure, and it takes the flag rather than reading it, so the rule can be asserted without a host
/// and the two call sites cannot disagree about which prefix belongs to which path.
pub fn host_path(path: &str, is_flatpak: bool) -> String {
    if !is_flatpak || path.is_empty() {
        return path.to_string();
    }
    // Only an ABSOLUTE path is on the host's filesystem. A relative one is this process's own, and
    // prefixing it would compose an address nothing binds — the original never sees one here, and a
    // rule that is wrong on an input it is never given is still a rule that is wrong.
    if !path.starts_with('/') {
        return path.to_string();
    }
    if path == RUN_USER || path.starts_with(&format!("{RUN_USER}/")) {
        return format!("/var{path}");
    }
    format!("{HOST_PREFIX}{path}")
}
