//! Where the server listens, and what it refuses to listen on.
//!
//! **One protocol, two listeners.** Locally that is a Unix domain socket — a named pipe on Windows —
//! whose access control is the filesystem's. Remotely it is a TCP port, and the only thing standing in
//! front of it is a bearer token. What travels over both is byte-for-byte the same: the same WebSocket
//! handshake, the same frames, the same [`crate::protocol`] envelopes, the same session code. There is
//! deliberately no local shortcut — not a leaner framing, not an auth bypass, not a second dispatch
//! path — because a second path is how the two come to disagree about what the protocol is, and the one
//! that gets exercised less is always the remote one, which is the one that faces a network.
//!
//! **This module is the DECISION and performs no I/O.** Which address is allowed, whether a token is
//! required, what a refusal is called: all of it is a pure function of the configuration, so all of it
//! is checkable from any machine. The syscalls live in [`endpoint`], which is thin on purpose — a
//! platform-specific decision behind a `cfg` is a decision no gate can see.
//!
//! **The security posture, and it is not negotiable**: remote is off
//! unless something asks for it, a remote listener without a token does not bind AT ALL, the token is
//! compared in constant time, and the token cannot be logged because [`auth::Token`] has no `Debug`
//! that prints it. This is the one part of the port where a mistake is a vulnerability rather than a
//! bug, so the refusals are values with tests rather than early returns with comments.
//!
//! **`wss://` is provided** ([`tls`]), and it is what makes the token above worth having off the
//! machine: presented in a header, it is readable and replayable by anything on the path until the
//! transport is encrypted. It is opt-in rather than mandatory because a remote listener behind an SSH
//! tunnel or a reverse proxy is already encrypted by something that owns the certificate, and refusing
//! to bind for it would push operators onto a worse arrangement. What is not optional is being TOLD:
//! plaintext is warned about at every start.

use std::net::SocketAddr;
use std::path::PathBuf;

pub mod auth;

pub mod clients;

pub mod session;

pub mod endpoint;

pub mod tls;

/// How long a peer may take to finish the handshake before the socket is dropped.
///
/// **A limit rather than a courtesy.** Without one, anything that can open a connection can hold a task
/// and a file descriptor by saying nothing at all, for as long as it likes, as many times as it likes.
/// Ten seconds is far beyond what a handshake takes on a loopback or a socket and short enough that the
/// cost of a silent peer is bounded.
///
/// The DEFAULT rather than the value: what a listener actually reads is
/// [`session::Shared::handshake_timeout`], which [`session::Shared::new`] fills from here. The two
/// arms that fire when it passes cannot be reached in a suite at ten seconds, and an arm nothing
/// executes is an arm nobody has thought about.
pub const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// The largest frame this server will read from a client.
///
/// tungstenite's own default is 64 MiB, which is a sane default for a general WebSocket and far too much
/// for this protocol: the largest frame a client legitimately sends is one connection record. A megabyte
/// leaves room for a document with fields this core does not model and still bounds what an abusive
/// client can make the process buffer. **It limits READING only** — a forwarded stream chunk goes out
/// whatever its size.
pub const MAX_INCOMING_FRAME_BYTES: usize = 1 << 20;

/// The mode the local socket carries: readable and writable by its owner, and by nobody else.
///
/// This IS the local listener's access control — there is no token on that
/// path, so the filesystem is the whole of it. `0o600` rather than `0o660`: a group-writable socket
/// grants full container-engine control to every member of the owner's primary group, which on many
/// distributions is a group with more than one member.
pub const LOCAL_SOCKET_MODE: u32 = 0o600;

/// How many frames one client may fall behind by before it is disconnected.
///
/// In FRAMES rather than bytes, per [`crate::queue::ClientQueue`]: what this protects against is a
/// client that has stopped reading, not one reading large messages slowly. Two hundred is enough that
/// no ordinary burst reaches it — a connect publishes on the order of ten progress lines — and small
/// enough that a hopeless client is noticed while its backlog is still measured in kilobytes.
pub const CLIENT_QUEUE_CAPACITY: usize = 200;

/// Everything the process was asked to listen on.
///
/// Both are optional and **at least one is required**: a server with no listener would come up, log
/// that it was ready and answer nobody, which is the failure mode that wastes an afternoon.
#[derive(Debug, Clone, Default)]
pub struct Listen {
    /// The local socket. The default, and the only one the desktop app's own client would use.
    pub local: Option<PathBuf>,
    /// The remote listener. **Absent means off**, which is task 4's first rule expressed as a type
    /// rather than as a flag someone can default to `true`.
    pub remote: Option<Remote>,
}

/// A remote listener: an address, and the token that guards it.
///
/// **The token is not optional, and that is stricter than a non-loopback rule would be.** A token
/// is required to bind at all, not only a NON-loopback address. The reason is that the
/// exemption would have rested on a claim this process cannot make: a loopback TCP port has no
/// filesystem permissions, so every local user and every sandboxed process on the machine can reach it,
/// where the local socket is protected by its mode. "Loopback is safe" is true of the network and false
/// of the machine. The local socket already serves the same-machine case, so requiring a token here
/// costs a caller nothing that is not already available to it.
///
/// **`tls` absent means the token crosses in the clear**, which is a legitimate arrangement and never a
/// silent one: it is what a listener behind an SSH tunnel or a reverse proxy wants, where something else
/// owns the certificate. Anywhere else, anything that can read the wire can read the token and replay
/// it, so [`tls::ServerTls`] is what a listener facing an untrusted path needs — and the absence is
/// warned about at every start rather than left in a manual.
#[derive(Debug, Clone)]
pub struct Remote {
    pub address: SocketAddr,
    pub token: auth::Token,
    /// The certificate this listener terminates, or `None` for a plaintext one. **An `Option` rather
    /// than a flag with a path beside it**: there is no way to express "encrypted, but the material was
    /// not usable", because the material is checked into existence before this value can be built.
    pub tls: Option<tls::ServerTls>,
}

/// Why a listener will not be created. Every one of these is decided BEFORE anything binds.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ListenError {
    /// Nothing to listen on. See [`Listen`].
    #[error("no listener was configured: give a local socket path, a remote address, or both")]
    NothingConfigured,
    /// A remote address was given with no token. **The refusal task 4 requires**, widened to every
    /// address for the reason [`Remote`] states.
    #[error(
        "a remote listener needs a token: {address} would otherwise grant full container-engine control to anything that can reach it"
    )]
    RemoteNeedsToken { address: SocketAddr },
    /// A token was supplied that cannot guard anything. An empty token is not a weak secret, it is the
    /// absence of one wearing the shape of a secret, and it would compare equal to an empty header.
    #[error("the token is empty: that is not a weak secret, it is no secret")]
    TokenIsEmpty,
}

/// What was asked for, once it is known to be admissible.
///
/// Constructing this IS the check — there is no way to hold one that was not admitted, so a caller
/// cannot bind first and validate afterwards.
#[derive(Debug, Clone)]
pub struct Admitted(Listen);

impl Admitted {
    /// Decide whether this configuration may listen.
    ///
    /// A pure function of the request, deliberately: what makes the posture testable on any machine is
    /// that no part of it consults the network, the filesystem or the platform.
    pub fn admit(listen: Listen) -> Result<Self, ListenError> {
        if listen.local.is_none() && listen.remote.is_none() {
            return Err(ListenError::NothingConfigured);
        }
        if let Some(remote) = &listen.remote
            && remote.token.is_empty()
        {
            return Err(ListenError::TokenIsEmpty);
        }
        Ok(Self(listen))
    }

    /// The same decision, from the parts a caller has: an address, whatever token it found, and
    /// whatever certificate it was given.
    ///
    /// This is the shape the binary actually holds — `--remote` with no `--token-file` — and it exists
    /// so the "no token" case is a refusal from this module rather than an `unwrap` in `main`.
    pub fn remote_from(
        address: SocketAddr,
        token: Option<auth::Token>,
        tls: Option<tls::ServerTls>,
    ) -> Result<Remote, ListenError> {
        let Some(token) = token else {
            return Err(ListenError::RemoteNeedsToken { address });
        };
        if token.is_empty() {
            return Err(ListenError::TokenIsEmpty);
        }
        Ok(Remote {
            address,
            token,
            tls,
        })
    }

    pub fn local(&self) -> Option<&PathBuf> {
        self.0.local.as_ref()
    }

    pub fn remote(&self) -> Option<&Remote> {
        self.0.remote.as_ref()
    }

    /// Whether this configuration reaches beyond the machine, for the one log line that says so.
    ///
    /// A server that has quietly bound `0.0.0.0` is the thing an operator most needs told, and the
    /// answer is a property of the address rather than of the intent behind it.
    pub fn is_reachable_off_host(&self) -> bool {
        self.0
            .remote
            .as_ref()
            .is_some_and(|remote| !remote.address.ip().is_loopback())
    }

    /// Whether the remote listener terminates TLS. `false` when there is no remote listener at all,
    /// which is the honest answer to "is anything crossing a network in the clear".
    pub fn is_encrypted(&self) -> bool {
        self.0
            .remote
            .as_ref()
            .is_some_and(|remote| remote.tls.is_some())
    }

    /// The one combination with no good arrangement behind it: reachable from another machine, and in
    /// the clear.
    ///
    /// **Warned about rather than refused**, and the line between the two is where a legitimate use
    /// stops existing. Plaintext on loopback is what an SSH tunnel and a reverse proxy both produce, and
    /// both are correct — something else owns the certificate. Plaintext off-host has one real case
    /// left, a terminator in another container on a private network, and refusing would leave it with
    /// nowhere to go. So this is a value the start-up log reads, not a bind that fails.
    pub fn is_exposed_in_the_clear(&self) -> bool {
        self.is_reachable_off_host() && !self.is_encrypted()
    }
}
