//! Where an SSH forward binds locally.
//!
//! Ported from `Application.ts:ensureRemoteForwardAddress`. Automatic detection leaves the API URI
//! empty for a remote host — the engine socket is on the other machine — so the local end of the
//! tunnel has to be DERIVED, and derived the same way by every implementation: the desktop app may
//! already be listening on that exact path.

use crate::domain::pathing::join;
use crate::domain::types::os::OperatingSystem;
use crate::runtimes::dialects::podman_machine_pipe::pipe_name;
use crate::runtimes::dialects::shared::strip_scheme;

/// `utils:getWindowsPipePath` — the local pipe an SSH relay serves on.
pub fn windows_pipe_path(key: &str) -> String {
    format!("\\\\.\\pipe\\container-desktop-ssh-relay-{key}")
}

/// `utils:getWindowsPipePath(name, true)` — a pipe path for a name that IS the pipe's own.
///
/// The engine's, not the app's: podman lists its machine pipe as `podman-machine-default` and Docker
/// Desktop serves `dockerDesktopLinuxEngine`, neither of which is served by anything this app runs, so
/// neither may carry the relay prefix.
pub fn windows_named_pipe_path(name: &str) -> String {
    format!("\\\\.\\pipe\\{name}")
}

/// Whether an address is a named PIPE rather than a forwardable socket path.
///
/// `ssh -NL` binds unix-domain sockets and speaks nothing else, so a pipe is precisely what data
/// plane B — the `dial-stdio` bridge — exists for. The same rule `normalize_unix_socket_path` states
/// from the other side: an `npipe://` address survives scheme-stripping because it is bridged rather
/// than forwarded.
///
/// Asked of the ADDRESS rather than of the operating system on purpose. What cannot be forwarded is
/// the pipe; `resolve_scope_uri` is the only reason one appears, and testing for the OS instead would
/// pass a pipe through whenever the pipe arrived from somewhere else (a manual setting, say).
///
/// **Every spelling, and that is the union of the original's two predicates.** `utils:isNamedPipe`
/// knows `\\.\pipe\` and `npipe://`; `podman-machine-pipe.ts:isWindowsNamedPipe` also knows the
/// forward-slash form podman prints inside a URI (`//./pipe/…`) and the `\\?\` device prefix. A form
/// one of them missed is a pipe treated as a socket — forwarded, or overwritten by an in-VM path — so
/// there is one predicate and it accepts all of them.
pub fn is_named_pipe(address: &str) -> bool {
    if strip_scheme(address, "npipe://").is_some() {
        return true;
    }
    // `\\.\pipe\…` and `\\?\pipe\…`, in either separator — the shape the original matches with a
    // regexp, and the separator is required after `pipe` so `\\.\pipefoo` is not one.
    let normalized = address.replace('\\', "/").to_ascii_lowercase();
    normalized.starts_with("//./pipe/") || normalized.starts_with("//?/pipe/")
}

/// The pipe's own name, but ONLY when the address really is a pipe — `utils:getWindowsPipeName`.
///
/// [`pipe_name`] alone reads the last segment after a `pipe` separator, which is all
/// `parse_podman_machine_named_pipe` needs because it has already filtered its input to `npipe://`
/// URIs. A caller holding an arbitrary path has not, and for one of those the loose rule is wrong:
/// `/home/me/pipe/socket` would answer `socket`. Pairing the predicate with the reader is what makes
/// the question safe to ask of anything, which is what a filesystem port has to do.
pub fn windows_pipe_name(address: &str) -> Option<&str> {
    if !is_named_pipe(address) {
        return None;
    }
    pipe_name(address)
}

/// The local address the `ssh -NL` forward binds for this connection.
///
/// A Unix-domain socket path is capped near 104 bytes and a connection id
/// (`host.<uuid>.docker.remote`) plus a data directory overflows it, so POSIX hashes the id into a
/// short filename. A named pipe has no such cap and keeps the readable id.
pub fn local_forward_address(
    os: OperatingSystem,
    connection_id: &str,
    user_data_path: &str,
) -> String {
    if os == OperatingSystem::WindowsNt {
        return windows_pipe_path(connection_id);
    }
    join(
        os,
        user_data_path,
        &format!("cdt-ssh-{}.sock", short_stable_hash(connection_id)),
    )
}

/// `Application.ts:shortStableHash` — FNV-1a, 32-bit, as eight hexadecimal digits.
///
/// Ported bit for bit rather than replaced by a stronger hash: the desktop app builds the socket
/// filename with THIS function, and a core that computes a different one binds a different socket
/// while reporting success. The oracle hashes UTF-16 code units because `charCodeAt` does, so this
/// does too — `encode_utf16`, never `bytes`.
pub fn short_stable_hash(input: &str) -> String {
    const OFFSET_BASIS: u32 = 0x811c_9dc5;
    const PRIME: u32 = 0x0100_0193;

    let mut hash = OFFSET_BASIS;
    for unit in input.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(PRIME);
    }
    format!("{hash:08x}")
}
