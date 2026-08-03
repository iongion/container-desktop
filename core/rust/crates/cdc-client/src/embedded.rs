//! A server in this process, reached exactly the way a server on another machine is.
//!
//! **This is the transport a shortcut is most tempting in, and the design says so in as many words.**
//! The temptation is to hand a client a `&Server` and call `dispatch` — no socket, no handshake, no
//! JSON. What that would cost is the thing the protocol is for: an in-process path that passed native
//! values would accept a command the wire cannot carry and reject nothing the wire rejects, and the two
//! modes would disagree the first time anybody attached remotely.
//!
//! So there is no in-process message type here. There is a PIPE — [`tokio::io::duplex`] — with a real
//! RFC 6455 handshake over it, real JSON envelopes through it, and the real
//! [`cdc_server::listen::session::serve`] on the far end: the same function
//! `endpoint.rs` calls for an accepted socket, reached the same way, with the same
//! [`cdc_server::listen::clients::Attached`] queue and the same backpressure rule. **Everything that
//! makes a frame legal or illegal is therefore the same code**, and a test says so with the same bytes
//! down this transport and down a real one.
//!
//! What embedded does NOT have is a listener, so it has no address to be refused at and no token to
//! present. That is the whole of its difference, and it is the same difference the local socket has
//! from the remote port.

use std::sync::Arc;

use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::capabilities::fs::FsLocks;
use cdc_server::listen::CLIENT_QUEUE_CAPACITY;
use cdc_server::listen::session::{self, Shared};
use cdc_server::server::MachineBuilder;

use crate::{Client, ClientError};

/// What this transport's clients are called, alongside `local-1` and `remote-3`.
///
/// A client id says which listener admitted it, so an embedded one has to say that it was not admitted
/// by a listener at all — otherwise a log from a client running its own server is indistinguishable from
/// one that attached over a socket.
const EMBEDDED: &str = "embedded";

/// Run a session for this process's own server, and hand back the pipe to it.
///
/// **Separate from [`attach`] because they are two facts, not one step**: that a server is running
/// here, and that something is talking to it. A caller with its own reason to speak the handshake —
/// a test putting a deliberately malformed frame on the wire, most usefully — needs the first without
/// the second, and would otherwise have to reach around this module to get it.
///
/// The session is spawned onto the shared `tokio_util::task::TaskTracker`, so a graceful shutdown
/// waits for it exactly as it waits for a socket's — a client that quits mid-frame does not leave the
/// server writing into a pipe nobody will read.
pub fn pipe<F, B, C>(shared: Arc<Shared<F, B, C>>) -> crate::dial::Wire
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let (wire, served) = crate::dial::Wire::duplex();
    let session = Arc::clone(&shared);
    // Spawned before the caller drives its own half, because the two handshakes are one exchange: each
    // waits on bytes the other has not written yet, so driving one side alone is a deadlock rather than
    // a slow start.
    shared.tasks.spawn(async move {
        let Ok(socket) = tokio_tungstenite::accept_async(served).await else {
            // The caller took the pipe and never spoke into it — a client that failed to start, or a
            // handshake this process abandoned. Give up rather than hold a task, and never reach the
            // roster: a client that never attached has nothing to be sent. An arm and not an `unwrap`,
            // because an `unwrap` here takes a terminal down with it.
            return;
        };
        let attached = session.clients.attach(EMBEDDED, CLIENT_QUEUE_CAPACITY);
        session::serve(socket, attached, session).await;
    });
    wire
}

/// A client of this process's own server, over that pipe.
pub async fn attach<F, B, C>(shared: Arc<Shared<F, B, C>>) -> Result<Client, ClientError>
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let wire = pipe(shared);
    Ok(Client::new(
        crate::dial::speak("ws://localhost/", None, EMBEDDED, wire).await?,
    ))
}
