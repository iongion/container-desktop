//! `runtimes/dialects/podman-machine-ssh.ts` — reaching a podman MACHINE through an SSH remote.
//!
//! The machine's API socket lives inside its VM, and podman's own remote client cannot dial it from a
//! non-interactive SSH session: its bundled Go SSH client only ever offers `[none, password]` and never
//! the publickey the machine identity is. OpenSSH loads that exact key without complaint, so the bridge
//! is one more OpenSSH hop into the machine running the machine's OWN `podman system dial-stdio` —
//! pure SSH stdio onto a unix socket, no docker, no insecure TCP.
//!
//! **Pure, and here rather than in the transport, for the reason [`crate::domain::wsl_args`] is**: the
//! argv IS the observable behaviour. An option in the wrong place produces a command that runs and
//! reaches a different engine, which is a thing to assert in a test rather than to discover against a
//! live machine. What the transport adds is the OUTER hop — this command runs on the remote HOST.
//!
//! **`DialStdioBridge.relay` is deliberately not carried.** The original composes one
//! (`ssh://user@host:port/socket`) as a stable id for the relay process it starts; this port has no
//! relay, and `machine::proxy::endpoint` resolves the bridge itself, so a second
//! address would be one more thing for the first to disagree with. `relay` stays what the engine
//! reported it is listening on, exactly as [`crate::runtimes::profiles::shared::WslProfile`] leaves the
//! in-guest socket it cannot dial either.

use crate::domain::ssh::args::DEFAULT_SSH_PORT;
use crate::runtimes::dialects::podman_machine_connections::{
    PodmanSystemConnection, prefer_rootless_machine_connection,
};
use crate::runtimes::dialects::shared::strip_scheme;

/// The engine binary INSIDE the machine.
///
/// A constant rather than `settings.program`, and the original passes no argument either: the detected
/// program is the remote HOST's — `C:\…\podman.exe` on Windows — and names nothing in a Linux VM. A
/// podman machine runs podman by definition, so there is no other answer for this to select between.
const MACHINE_ENGINE_PROGRAM: &str = "podman";

/// What `podman system connection list` says about how to reach a machine — `PodmanMachineSSH`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PodmanMachineSsh {
    /// EMPTY when the URI named none, which `ssh` answers by using the local user.
    pub user: String,
    pub host: String,
    pub port: i64,
    /// The socket INSIDE the VM. Carried because it is what the URI said; the nested `dial-stdio`
    /// reaches the machine's default socket, which is the same one.
    pub socket: String,
    /// The machine's private key, in podman's own store.
    pub identity: String,
}

impl PodmanMachineSsh {
    /// `buildSSHTarget`'s rule, and the same one [`crate::domain::ssh::args::SshCredentials`] applies:
    /// `@host` with no user is a request to log in as nobody.
    fn target(&self) -> String {
        if self.user.is_empty() {
            return self.host.clone();
        }
        format!("{}@{}", self.user, self.host)
    }
}

/// `parseSSHURI` — `ssh://user@127.0.0.1:56515/run/podman/podman.sock`, taken apart.
///
/// Written with string splits rather than a pattern because every part is delimited: nothing here is
/// worth a dependency, and the original's regexp is only doing what `find` does four times.
///
/// `None` for anything that is not an SSH URI, and for a port that is not a number — the original's
/// `\d+` refuses the same. A partly-read URI would compose a command naming the wrong host.
fn parse_ssh_uri(uri: &str) -> Option<(String, String, i64, String)> {
    let rest = strip_scheme(uri.trim(), "ssh://")?;
    let (authority, socket) = match rest.find('/') {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, ""),
    };
    let (user, endpoint) = match authority.find('@') {
        Some(at) => (&authority[..at], &authority[at + 1..]),
        None => ("", authority),
    };
    let (host, port) = match endpoint.find(':') {
        Some(at) => (&endpoint[..at], &endpoint[at + 1..]),
        None => (endpoint, ""),
    };
    if host.is_empty() {
        return None;
    }
    let port = if port.is_empty() {
        DEFAULT_SSH_PORT
    } else {
        port.parse().ok()?
    };
    Some((user.to_string(), host.to_string(), port, socket.to_string()))
}

/// `parsePodmanMachineSSHConnection` — the machine to bridge, out of what podman listed.
///
/// Only `IsMachine` entries carrying both a URI and an identity qualify. A directly-reachable native
/// remote podman has no identity here, so this answers `None` and the caller keeps the `ssh -NL`
/// unix-socket forward it already had — the absence is the SELECTION, not a failure.
///
/// Takes the parsed list rather than the raw JSON, which is where this port differs from the original
/// and why [`crate::runtimes::dialects::podman_machine_connections`] exists: the original re-derives
/// this shape at each of its three call sites.
pub fn machine_ssh_connection(connections: &[PodmanSystemConnection]) -> Option<PodmanMachineSsh> {
    let machines: Vec<PodmanSystemConnection> = connections
        .iter()
        .filter(|entry| entry.is_machine && !entry.uri.is_empty() && !entry.identity.is_empty())
        .cloned()
        .collect();
    let chosen = prefer_rootless_machine_connection(&machines)?;
    let (user, host, port, socket) = parse_ssh_uri(&chosen.uri)?;
    Some(PodmanMachineSsh {
        user,
        host,
        port,
        socket,
        identity: chosen.identity.clone(),
    })
}

/// `buildPodmanMachineDialStdioCommand` — the command run ON THE REMOTE HOST.
///
/// Nest OpenSSH into the machine, then the VM's local `dial-stdio`, which bridges to the in-VM socket.
/// The two options that look like laxity are the load-bearing ones: the machine's host key rotates on
/// every recreation and lives only in podman's own store, so `StrictHostKeyChecking=no` is the
/// alternative to failing after every rebuild; `BatchMode=yes` is what stops a prompt hanging the
/// bridge, because nothing is attached to a stdio channel to answer one.
///
/// The identity is QUOTED, with literal quote characters rather than shell syntax: the outer `ssh`
/// hands this to the remote's shell, and on a Windows remote that is cmd.exe, where an unquoted
/// profile path with a space becomes two arguments.
pub fn dial_stdio_args(machine: &PodmanMachineSsh) -> Vec<String> {
    vec![
        "ssh".to_string(),
        "-i".to_string(),
        format!("\"{}\"", machine.identity),
        "-p".to_string(),
        machine.port.to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=no".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        machine.target(),
        MACHINE_ENGINE_PROGRAM.to_string(),
        "system".to_string(),
        "dial-stdio".to_string(),
    ]
}
