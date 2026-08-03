//! The sockets: binding them, accepting on them, and letting go of them.
//!
//! **Thin on purpose.** Every decision this module acts on was already made somewhere checkable —
//! [`super::Admitted`] decided what may be listened on, [`super::auth`] decides who may attach, and
//! [`super::session`] decides what happens once one has. What is left here is the part that must call a
//! syscall, and it is kept small because a `cfg` is a decision no gate on this machine can see: the Unix
//! and Windows halves differ only in the four lines that make a listener.
//!
//! **Two things here are security, not plumbing.** A handshake that never finishes must not hold a task
//! forever, so it has a deadline — the alternative is that anything which can open a socket can exhaust
//! the process by opening many and saying nothing. And an incoming message has a size cap, because
//! tungstenite's default is 64 MiB and this protocol's largest frame is a connection record.
//!
//! **Binding is not idempotent and pretending otherwise is how two servers fight over one socket.** A
//! socket file left behind by a crash looks exactly like one a live server is using, and the only thing
//! that tells them apart is trying to connect: an answer means a server, a refusal means a corpse. So a
//! stale file is replaced and a live one is a refusal to start — never the other way round, because
//! unlinking a socket another process is serving takes that server offline while it still thinks it is
//! up. Named pipes have no equivalent problem: the kernel destroys the object with its last handle.

use std::io::ErrorKind;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::capabilities::fs::FsLocks;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;

use tokio_rustls::TlsAcceptor;

use crate::listen::auth::{self, AUTHORIZATION, Token};
use crate::listen::session::{self, Shared};
use crate::listen::{Admitted, CLIENT_QUEUE_CAPACITY, MAX_INCOMING_FRAME_BYTES, Remote};
use crate::server::MachineBuilder;

/// What a client id is prefixed with, per listener. Not cosmetic: it is what makes a log line about
/// `remote-3` tell an operator that the frame came from off the machine.
const LOCAL: &str = "local";
const REMOTE: &str = "remote";

/// Why the process will not start.
///
/// Every one of these happens before a single client is served, which is the point: a server that comes
/// up half-listening is worse than one that refuses, because the half that is missing is discovered by
/// whoever depended on it.
#[derive(Debug, thiserror::Error)]
pub enum BindError {
    /// Another server is serving that socket right now — it answered a connection. **Never treated as
    /// stale**, because replacing it would take a working server offline without telling it.
    #[error("{path} is already being served by another process")]
    LocalInUse { path: PathBuf },
    #[error("cannot listen on {path}: {source}")]
    Local {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("cannot listen on {address}: {source}")]
    Remote {
        address: SocketAddr,
        #[source]
        source: std::io::Error,
    },
}

/// Whether a bind failure means something is ALREADY at that address.
///
/// **Deliberately not behind a `cfg`, even though the two platforms reach it differently.** It is the
/// whole of the stale-versus-live decision: `AddrInUse` is the one failure a socket file left by a crash
/// can produce, and it is also what Windows answers when another process holds the pipe name with
/// `first_pipe_instance`. Every other failure — a path a socket cannot have, a directory that cannot be
/// written — is reported as itself rather than investigated, because investigating it would replace the
/// reason with whatever the investigation failed on. A decision compiled on one platform only is a
/// decision `cargo mutants` cannot kill and no Linux gate can execute (`http::is_pipe_busy` carries the
/// same note), so the rule is ordinary tested code and only the I/O call is platform-bound.
pub fn is_address_taken(error: &std::io::Error) -> bool {
    error.kind() == ErrorKind::AddrInUse
}

/// One accept result, with the failure logged and the listener kept alive.
///
/// **Split out for the same reason [`is_address_taken`] is, and it is the same kind of decision.**
/// Nothing a test can do to a bound listener makes `accept` fail, so a decision left inside the loop
/// is a decision no gate on this machine can execute — here it is ordinary tested code and only the
/// syscall stays out of reach.
///
/// `None` means go round again, and never means stop: a per-accept failure is ONE client whose
/// connection died between the kernel accepting it and this reading it, and taking the listener down
/// over that would end a server on behalf of everyone else it was serving. The `kind` is a field
/// rather than two spellings of the message, which is what `serve_admitted` does with the same
/// distinction one layer down.
pub fn accepted<T>(outcome: std::io::Result<T>, kind: &'static str) -> Option<T> {
    match outcome {
        Ok(accepted) => Some(accepted),
        Err(error) => {
            tracing::warn!(kind, %error, "a client could not be accepted");
            None
        }
    }
}

/// The local listener's type on this platform. A Unix socket, or a named pipe instance on Windows.
#[cfg(unix)]
type LocalListener = tokio::net::UnixListener;
#[cfg(windows)]
type LocalListener = tokio::net::windows::named_pipe::NamedPipeServer;

/// Listeners that are bound and not yet accepting.
///
/// Binding is separate from serving so that a caller — the binary, or a test — knows the sockets exist
/// before anything is expected to reach them. A `run` that bound its own listeners would make "is it up
/// yet?" a question only a sleep could answer.
pub struct Serving<F: FsLocks, B: MachineBuilder, C: Clock> {
    shared: Arc<Shared<F, B, C>>,
    local: Option<(PathBuf, LocalListener)>,
    remote: Option<(TcpListener, Token, Option<TlsAcceptor>)>,
}

/// Hand-written because the listeners and the shared state are not `Debug`. It prints what a failing
/// assertion needs: which of the two listeners this process actually has.
impl<F: FsLocks, B: MachineBuilder, C: Clock> std::fmt::Debug for Serving<F, B, C> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Serving")
            .field("local", &self.local.as_ref().map(|(path, _)| path))
            .field(
                "remote",
                &self
                    .remote
                    .as_ref()
                    .and_then(|(listener, ..)| listener.local_addr().ok()),
            )
            // Whether the remote listener terminates TLS, which is the one thing about it an operator
            // reading a failed assertion cannot get from an address.
            .field(
                "remote_tls",
                &self
                    .remote
                    .as_ref()
                    .map(|(_, _, acceptor)| acceptor.is_some()),
            )
            .finish()
    }
}

impl<F, B, C> Serving<F, B, C>
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    /// Bind everything that was admitted. Nothing is accepted until [`Serving::run`].
    pub async fn bind(
        shared: Arc<Shared<F, B, C>>,
        admitted: &Admitted,
    ) -> Result<Self, BindError> {
        let mut local = None;
        if let Some(path) = admitted.local() {
            local = Some((path.clone(), bind_local(path).await?));
        }
        let mut remote = None;
        if let Some(Remote {
            address,
            token,
            tls,
        }) = admitted.remote()
        {
            remote = Some((
                bind_remote(*address).await?,
                token.clone(),
                tls.as_ref().map(|tls| tls.acceptor()),
            ));
        }
        Ok(Self {
            shared,
            local,
            remote,
        })
    }

    /// The address the remote listener actually got, which is not the one asked for when port 0 was.
    ///
    /// A test binds port 0 precisely so it never collides with a port the machine is using; without this
    /// it would have no way to reach what it bound.
    pub fn remote_address(&self) -> Option<SocketAddr> {
        self.remote
            .as_ref()
            .and_then(|(listener, ..)| listener.local_addr().ok())
    }

    /// Accept until the shutdown token is cancelled, then take everything down in order.
    ///
    /// **The order is the whole of task 8.** Stop accepting, ask every client to go, wait for the tasks
    /// that were mid-frame, and only then take the connections down — because taking them down first
    /// would have a client watching a log see the stream die with no explanation, when what is available
    /// is a terminal frame and a close. The connections go last and they are what kills the tunnels.
    pub async fn run(self) {
        let shutdown = self.shared.shutdown.clone();
        let local = self.local.as_ref().map(|(path, _)| path.clone());
        tokio::select! {
            _ = shutdown.cancelled() => {}
            _ = accept_local(self.local, Arc::clone(&self.shared)) => {}
            _ = accept_remote(self.remote, Arc::clone(&self.shared)) => {}
        }
        tracing::info!("shutting down");
        self.shared.clients.cancel_all();
        self.shared.tasks.close();
        self.shared.tasks.wait().await;
        self.shared.stop_connections().await;
        if let Some(path) = local {
            release_local(&path);
        }
    }
}

/// Accept local clients forever. Returns only on an error the listener cannot recover from.
///
/// A per-accept error is logged and the loop continues: one client whose connection died between the
/// kernel accepting it and this reading it must not take the listener with it.
#[cfg(unix)]
async fn accept_local<F, B, C>(
    local: Option<(PathBuf, LocalListener)>,
    shared: Arc<Shared<F, B, C>>,
) where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let Some((_, listener)) = local else {
        // Nothing local was configured. This branch of the select must never resolve, or it would end a
        // run that is serving perfectly well remotely.
        return std::future::pending().await;
    };
    loop {
        if let Some((stream, _)) = accepted(listener.accept().await, LOCAL) {
            attach(stream, LOCAL, None, Arc::clone(&shared));
        }
    }
}

/// The same, over named pipe instances.
///
/// **A pipe is accepted by BECOMING the connection**, so the next instance has to be created before this
/// one is served — otherwise there is a window in which the pipe name exists with no listener and a
/// client is told the pipe is busy. This is the shape tokio documents, and it is the whole of the
/// Windows difference.
#[cfg(windows)]
async fn accept_local<F, B, C>(
    local: Option<(PathBuf, LocalListener)>,
    shared: Arc<Shared<F, B, C>>,
) where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let Some((path, mut listener)) = local else {
        return std::future::pending().await;
    };
    let name = path.as_os_str().to_owned();
    loop {
        if accepted(listener.connect().await, LOCAL).is_some() {
            match create_pipe(&name, false) {
                Ok(next) => {
                    let stream = std::mem::replace(&mut listener, next);
                    attach(stream, LOCAL, None, Arc::clone(&shared));
                }
                // The pipe name cannot be re-created, so this listener is finished. Serving the client
                // in hand and then stopping would be worse than refusing: the next client would find
                // nothing.
                Err(error) => {
                    tracing::error!(%error, "the local pipe cannot accept any more clients");
                    return;
                }
            }
        }
    }
}

async fn accept_remote<F, B, C>(
    remote: Option<(TcpListener, Token, Option<TlsAcceptor>)>,
    shared: Arc<Shared<F, B, C>>,
) where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let Some((listener, token, acceptor)) = remote else {
        return std::future::pending().await;
    };
    loop {
        if let Some((stream, peer)) = accepted(listener.accept().await, REMOTE) {
            tracing::debug!(%peer, "a remote client is connecting");
            match &acceptor {
                // **The TLS handshake is NOT done here**, and that is the same rule the WebSocket one
                // follows: it needs the peer to say something, so doing it in the accept loop would let
                // one silent client stop every other client being accepted. It goes into the spawned
                // task, under the same deadline, in [`attach_secure`].
                Some(acceptor) => {
                    attach_secure(stream, acceptor.clone(), token.clone(), Arc::clone(&shared))
                }
                None => attach(stream, REMOTE, Some(token.clone()), Arc::clone(&shared)),
            }
        }
    }
}

/// The same, with TLS terminated first.
///
/// **One extra layer on the stream and not one extra protocol path.** Everything after the wrap is
/// [`attach`] with a different `S`, so the handshake, the token check, the session and the frames are
/// the same lines they are on a plaintext listener — which is what makes `wss://` a transport rather
/// than a second server.
fn attach_secure<F, B, C>(
    stream: tokio::net::TcpStream,
    acceptor: TlsAcceptor,
    token: Token,
    shared: Arc<Shared<F, B, C>>,
) where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let tasks = shared.tasks.clone();
    tasks.spawn(async move {
        // The same deadline the WebSocket upgrade has — literally the same value, read off the same
        // field — for the same reason and now against a cheaper attack: a TLS handshake makes the server
        // do asymmetric crypto, so a peer that opens connections and abandons them mid-handshake costs
        // it more than a silent socket does.
        let deadline = shared.handshake_timeout;
        let secured = match tokio::time::timeout(deadline, acceptor.accept(stream)).await {
            Ok(Ok(stream)) => stream,
            // **One line for every failure, saying nothing about which check failed** — the rule
            // [`attach`] states about a refused token, and it covers more here: an unknown CA, an
            // expired certificate and a client offering no shared cipher suite are all information for
            // this process's operator and not for whoever is trying.
            Ok(Err(error)) => {
                tracing::warn!(kind = REMOTE, %error, "a client did not complete the TLS handshake");
                return;
            }
            Err(_) => {
                tracing::warn!(kind = REMOTE, "a client did not finish the TLS handshake in time");
                return;
            }
        };
        serve_admitted(secured, REMOTE, Some(token), shared).await;
    });
}

/// Hand one accepted stream to a session, once it has proved it speaks this protocol.
///
/// **The client is put on the roster only after the handshake succeeds.** A connection that fails auth
/// never becomes a client, never gets an id, and never receives a snapshot — the refusal happens while
/// it is still an anonymous socket.
fn attach<S, F, B, C>(
    stream: S,
    kind: &'static str,
    token: Option<Token>,
    shared: Arc<Shared<F, B, C>>,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let tasks = shared.tasks.clone();
    tasks.spawn(async move { serve_admitted(stream, kind, token, shared).await });
}

/// The handshake and the session, over a stream that is already open.
///
/// **Split out of [`attach`] so the TLS path can reach it without spawning twice**, and that is the
/// whole of the difference between the two callers: `attach` spawns and calls this, `attach_secure`
/// spawns, terminates TLS and calls this. There is exactly one place a client becomes a client.
async fn serve_admitted<S, F, B, C>(
    stream: S,
    kind: &'static str,
    token: Option<Token>,
    shared: Arc<Shared<F, B, C>>,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    match handshake(stream, token.as_ref(), shared.handshake_timeout).await {
        Ok(socket) => {
            let attached = shared.clients.attach(kind, CLIENT_QUEUE_CAPACITY);
            session::serve(socket, attached, shared).await;
        }
        // **Deliberately one line for every refusal**, and it says nothing about which check failed.
        // Whether a token was absent, wrong or malformed is information for this process's operator
        // and not for whoever is trying; the `kind` is what an operator actually needs.
        Err(error) => tracing::warn!(kind, %error, "a client was not admitted"),
    }
}

/// The upgrade, with the token check inside it.
///
/// **One function for both listeners**, and the difference between them is a value: `None` for the local
/// socket, whose access control is the filesystem's, and `Some` for a remote one. A second handshake
/// path for the local case is exactly the shortcut the design forbids.
// The `Err` variant is tungstenite's `ErrorResponse`, whose size is fixed by the `Callback` signature
// this closure has to satisfy. Boxing it — clippy's suggestion — is not available: the trait takes the
// unboxed type, and it is returned once per refused connection rather than on a hot path.
#[allow(clippy::result_large_err)]
async fn handshake<S>(
    stream: S,
    token: Option<&Token>,
    deadline: std::time::Duration,
) -> Result<WebSocketStream<S>, tokio_tungstenite::tungstenite::Error>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let config = WebSocketConfig::default().max_message_size(Some(MAX_INCOMING_FRAME_BYTES));
    let upgrade = tokio_tungstenite::accept_hdr_async_with_config(
        stream,
        |request: &Request, response: Response| {
            let Some(token) = token else {
                return Ok(response);
            };
            let presented = request
                .headers()
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok());
            if auth::admits(token, presented) {
                return Ok(response);
            }
            Err(unauthorized())
        },
        Some(config),
    );
    // A peer that opens a connection and says nothing holds a task and a file descriptor for as long as
    // it likes. With a deadline it holds them for ten seconds.
    match tokio::time::timeout(deadline, upgrade).await {
        Ok(result) => result,
        Err(_) => Err(tokio_tungstenite::tungstenite::Error::Io(
            std::io::Error::new(ErrorKind::TimedOut, "the handshake did not complete"),
        )),
    }
}

/// The refusal a rejected client is sent: a 401 and the scheme, and nothing else.
///
/// `WWW-Authenticate` is what makes it a protocol answer rather than a mystery — a client library can
/// tell "you need a token" from "this is not a WebSocket endpoint". The body says nothing about the
/// token, because a refusal that explains itself is a refusal that helps.
fn unauthorized() -> ErrorResponse {
    let mut response = ErrorResponse::new(Some("a bearer token is required".to_string()));
    *response.status_mut() = StatusCode::UNAUTHORIZED;
    response.headers_mut().insert(
        "www-authenticate",
        tokio_tungstenite::tungstenite::http::HeaderValue::from_static("Bearer"),
    );
    response
}

/// Bind the local socket, replacing a socket file no server is behind.
#[cfg(unix)]
async fn bind_local(path: &Path) -> Result<LocalListener, BindError> {
    let failed = |source: std::io::Error| BindError::Local {
        path: path.to_path_buf(),
        source,
    };
    if let Some(directory) = path.parent() {
        tokio::fs::create_dir_all(directory).await.map_err(failed)?;
    }
    let listener = match tokio::net::UnixListener::bind(path) {
        Ok(listener) => listener,
        Err(error) if is_address_taken(&error) => {
            if tokio::net::UnixStream::connect(path).await.is_ok() {
                return Err(BindError::LocalInUse {
                    path: path.to_path_buf(),
                });
            }
            tracing::info!(path = %path.display(), "replacing a socket file no server is behind");
            tokio::fs::remove_file(path).await.map_err(failed)?;
            tokio::net::UnixListener::bind(path).map_err(failed)?
        }
        Err(error) => return Err(failed(error)),
    };
    restrict(path).map_err(failed)?;
    Ok(listener)
}

/// Owner-only, which IS the local listener's access control.
///
/// There is a window between `bind` and this in which the socket carries the process umask, and closing
/// it properly needs a umask this process cannot set without `unsafe` — which the workspace forbids. What
/// makes it acceptable rather than ignored: the socket lives in the user's own data directory, so
/// widening it to that window means being able to write there already.
#[cfg(unix)]
fn restrict(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(
        path,
        std::fs::Permissions::from_mode(crate::listen::LOCAL_SOCKET_MODE),
    )
}

/// Create the first instance of the named pipe.
///
/// `AddrInUse` is what Windows answers when another process already holds the name with
/// `first_pipe_instance`, and it means the same thing `LocalInUse` means on Unix — with none of the
/// stale-file ambiguity, since a pipe dies with the process that made it.
#[cfg(windows)]
async fn bind_local(path: &Path) -> Result<LocalListener, BindError> {
    create_pipe(path.as_os_str(), true).map_err(|source| {
        if is_address_taken(&source) {
            return BindError::LocalInUse {
                path: path.to_path_buf(),
            };
        }
        BindError::Local {
            path: path.to_path_buf(),
            source,
        }
    })
}

#[cfg(windows)]
fn create_pipe(name: &std::ffi::OsStr, first: bool) -> std::io::Result<LocalListener> {
    // `reject_remote_clients` is tokio's default and it is left alone deliberately: a named pipe is
    // reachable over SMB, and the local listener is exactly the one that must not be.
    tokio::net::windows::named_pipe::ServerOptions::new()
        .first_pipe_instance(first)
        .create(name)
}

async fn bind_remote(address: SocketAddr) -> Result<TcpListener, BindError> {
    TcpListener::bind(address)
        .await
        .map_err(|source| BindError::Remote { address, source })
}

/// Remove the socket file this process bound, so the next start does not have to decide whether it is
/// stale. A failure is logged and never fatal — the process is already going.
#[cfg(unix)]
fn release_local(path: &Path) {
    if let Err(error) = std::fs::remove_file(path) {
        tracing::warn!(path = %path.display(), %error, "the socket file could not be removed");
    }
}

/// Nothing to release: the pipe object goes when its last handle does.
#[cfg(windows)]
fn release_local(_path: &Path) {}
