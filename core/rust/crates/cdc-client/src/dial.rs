//! Getting a byte stream to a server, four ways, and the one thing the four have in common.
//!
//! **The transport is the only difference between them.** A local socket, a TCP connection, that same
//! connection with TLS under it, and an in-process pipe all carry the same RFC 6455 handshake and the
//! same [`crate`] envelopes, because that is what [`cdc_server::listen`] decided on the other
//! side: one protocol, one session, no local shortcut. What survives that decision into a client is
//! small — this module — and what does not survive it is a second parser, a second framing and a second
//! set of bugs.
//!
//! **`wss://` is a stream that was wrapped, not a mode.** [`crate::tls`] decides what to trust and this
//! module puts the result where a `TcpStream` would have gone; everything above [`Wire`] is unchanged,
//! which is why nothing in `client.rs` mentions TLS at all.
//!
//! **A [`Wire`] is an enum rather than a boxed trait object, and what forces that is not one thing.**
//! `Box<dyn AsyncRead + AsyncWrite>` is not a type Rust has at all — a trait object names ONE trait —
//! so the alternatives are a local `trait Stream: AsyncRead + AsyncWrite` behind a box, or this. The
//! box was additionally unavailable when this was written, because reaching the supertraits through it
//! needs upcasting and the workspace MSRV was below the 1.86 that stabilised it; **that half has since
//! expired** and what remains is the half that was always the real
//! reason: the transport a client is on stays a value it can be ASKED about, which a boxed stream
//! erases. The delegation below is what that costs.
//!
//! **Only the syscall is platform-bound.** Which endpoint to dial is [`crate::Endpoint`]'s question and
//! is decided in portable code; that a local endpoint means `connect` on unix and `open` on a named
//! pipe is this module's, and it is three lines behind a `cfg`. A decision behind a `cfg` is a decision
//! no gate on this machine can execute — see `endpoint::is_address_taken`, which carries the same note
//! from the other end of the same socket.

use std::pin::Pin;
use std::task::{Context, Poll};

use secrecy::{ExposeSecret, SecretString};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};

use crate::{ClientError, Endpoint};

/// The local transport's type on this platform — a Unix socket, or a named pipe client on Windows.
///
/// Named to match [`cdc_server::listen::endpoint`]'s `LocalListener`, because it is the other end of
/// exactly that.
#[cfg(unix)]
pub type LocalStream = tokio::net::UnixStream;
#[cfg(windows)]
pub type LocalStream = tokio::net::windows::named_pipe::NamedPipeClient;

/// How big the in-process channel's buffer is, in bytes.
///
/// **The server's own read cap, rather than a number chosen here.** It has to hold the largest frame a
/// client may legitimately send without turning every write into a rendezvous with the reader — and
/// what "legitimately" means is already decided, once, on the other side of the pipe: a larger frame is
/// refused by the listener whatever transport it arrives on.
///
/// **Not what bounds a slow client.** That is `CLIENT_QUEUE_CAPACITY`, counted in frames, and it is a
/// different question: this bounds one write, that bounds a backlog.
const EMBEDDED_BUFFER_BYTES: usize = cdc_server::listen::MAX_INCOMING_FRAME_BYTES;

/// The bytes a client's frames travel over.
///
/// Four transports and no fourth behaviour: everything above this type is written once.
#[derive(Debug)]
pub enum Wire {
    /// A socket on this machine, protected by its filesystem mode rather than by a token.
    Local(LocalStream),
    /// A network connection, guarded by the bearer token presented during the handshake — **and by
    /// nothing else**, which is what [`Wire::Secure`] is for.
    Remote(TcpStream),
    /// The same network connection with TLS terminated under it, so the token is not readable by
    /// anything on the path.
    ///
    /// **Boxed, and the reason is not style**: a `TlsStream` holds a rustls session with its own
    /// buffers, which is a couple of orders of magnitude larger than a `TcpStream` — and an enum is the
    /// size of its largest variant, so every `Wire` in the process, including the embedded one, would
    /// carry that.
    Secure(Box<tokio_rustls::client::TlsStream<TcpStream>>),
    /// A pipe to a server in this process. Still a WebSocket, still JSON — see [`crate::Client`].
    Embedded(tokio::io::DuplexStream),
}

impl Wire {
    /// A pair of ends of one in-process channel: the client's, and the one a session is served on.
    pub fn duplex() -> (Self, tokio::io::DuplexStream) {
        let (client, server) = tokio::io::duplex(EMBEDDED_BUFFER_BYTES);
        (Self::Embedded(client), server)
    }

    /// Which transport this is, as a value a caller can ask for.
    ///
    /// **`remote+tls` rather than a word of its own**, because there are two questions here and both
    /// matter: whether the session leaves the machine, and whether it is readable on the way. A single
    /// word would answer one and quietly drop the other.
    ///
    /// **What a PERSON is told is the scheme, not this** — `wss://…` against `ws://…` in the chrome,
    /// which is [`crate::Endpoint`]'s `Display` and is what a live run actually shows. Said here
    /// because the sentence that used to be in this place claimed a status bar that does not read it,
    /// and a doc comment that asserts a rendering nothing performs is the kind nothing can falsify.
    pub fn transport(&self) -> &'static str {
        match self {
            Self::Local(_) => "local",
            Self::Remote(_) => "remote",
            Self::Secure(_) => "remote+tls",
            Self::Embedded(_) => "embedded",
        }
    }
}

impl AsyncRead for Wire {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Local(stream) => Pin::new(stream).poll_read(context, buffer),
            Self::Remote(stream) => Pin::new(stream).poll_read(context, buffer),
            Self::Secure(stream) => Pin::new(stream.as_mut()).poll_read(context, buffer),
            Self::Embedded(stream) => Pin::new(stream).poll_read(context, buffer),
        }
    }
}

impl AsyncWrite for Wire {
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            Self::Local(stream) => Pin::new(stream).poll_write(context, bytes),
            Self::Remote(stream) => Pin::new(stream).poll_write(context, bytes),
            Self::Secure(stream) => Pin::new(stream.as_mut()).poll_write(context, bytes),
            Self::Embedded(stream) => Pin::new(stream).poll_write(context, bytes),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Local(stream) => Pin::new(stream).poll_flush(context),
            Self::Remote(stream) => Pin::new(stream).poll_flush(context),
            Self::Secure(stream) => Pin::new(stream.as_mut()).poll_flush(context),
            Self::Embedded(stream) => Pin::new(stream).poll_flush(context),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Local(stream) => Pin::new(stream).poll_shutdown(context),
            Self::Remote(stream) => Pin::new(stream).poll_shutdown(context),
            Self::Secure(stream) => Pin::new(stream.as_mut()).poll_shutdown(context),
            Self::Embedded(stream) => Pin::new(stream).poll_shutdown(context),
        }
    }
}

/// Open the byte stream an endpoint names, before any protocol is spoken over it.
pub async fn open(endpoint: &Endpoint) -> Result<Wire, ClientError> {
    let unreachable = |source| ClientError::Unreachable {
        endpoint: endpoint.to_string(),
        source,
    };
    match endpoint {
        Endpoint::Local(path) => Ok(Wire::Local(open_local(path).await.map_err(unreachable)?)),
        Endpoint::Remote { address, tls, .. } => {
            let stream = TcpStream::connect(address).await.map_err(unreachable)?;
            let Some(tls) = tls else {
                return Ok(Wire::Remote(stream));
            };
            // **Not `unreachable`**, and the distinction is the point: something answered. A server
            // whose certificate this client will not trust is running perfectly well, and reporting it
            // as an absent one sends whoever is reading off to start a process that is already up.
            let secured = tls
                .connector()
                .connect(tls.name(), stream)
                .await
                .map_err(|source| ClientError::Untrusted {
                    endpoint: endpoint.to_string(),
                    source,
                })?;
            Ok(Wire::Secure(Box::new(secured)))
        }
    }
}

/// The one call that differs by platform: a socket is connected to, a named pipe is opened.
///
/// **ONE function with the `cfg` inside it, rather than two functions sharing a name**, and that is
/// forced by the mutation gate rather than a matter of taste: `.cargo/mutants.toml` excludes by NAME,
/// and code behind `cfg(windows)` is parsed here and never compiled here, so every mutant of it
/// survives. Two `open_local`s would make the windows one unexcludable without also excluding the unix
/// one — which is compiled, tested and must stay mutated. So the platform call that cannot be measured
/// from here is `open_named_pipe`, which has its own name and the exclusion the engine dialer's
/// identically-named function already carries.
async fn open_local(path: &std::path::Path) -> std::io::Result<LocalStream> {
    #[cfg(unix)]
    return LocalStream::connect(path).await;
    #[cfg(windows)]
    return open_named_pipe(path);
}

/// Windows has no `connect` for a pipe — the name IS the address, and opening it takes an instance.
///
/// `ClientOptions::open` is synchronous and returns `ERROR_PIPE_BUSY` when every instance the server
/// created is already serving somebody; the server creates the next instance before serving the one in
/// hand, so that is a race a retry would close rather than a server that is full. Reported as itself
/// rather than retried here, because a client that silently spun would hide a server that had stopped
/// accepting
///
/// The `CreateFileW` call and nothing else, which is the whole of why it may be excluded from the
/// mutation gate: the DECISIONS around it are portable code above.
#[cfg(windows)]
fn open_named_pipe(path: &std::path::Path) -> std::io::Result<LocalStream> {
    tokio::net::windows::named_pipe::ClientOptions::new().open(path)
}

/// Speak the WebSocket handshake to a dialled endpoint, presenting a token if it has one.
///
/// The handshake is where a remote server refuses an unauthorized client, so this is also where the
/// difference between "nothing is listening" and "you may not" becomes visible — and the two must not
/// be reported as one thing, because they have completely different answers.
pub async fn handshake(
    endpoint: &Endpoint,
    wire: Wire,
) -> Result<WebSocketStream<Wire>, ClientError> {
    let token = match endpoint {
        Endpoint::Remote { token, .. } => Some(token),
        Endpoint::Local(_) => None,
    };
    speak(&endpoint.url(), token, &endpoint.to_string(), wire).await
}

/// The crate's ONE WebSocket handshake, whatever the stream underneath it is.
///
/// **Embedded mode comes through here too**, which is what keeps it from being a second path: the
/// framing, the upgrade and the envelopes above it are the same lines for all three transports. What
/// genuinely differs is whether a token is presented — and that differs between LOCAL and REMOTE
/// already, so it is a parameter rather than a fork.
pub(super) async fn speak(
    url: &str,
    token: Option<&SecretString>,
    at: &str,
    wire: Wire,
) -> Result<WebSocketStream<Wire>, ClientError> {
    let mut request = url
        .into_client_request()
        .map_err(|source| ClientError::Handshake {
            endpoint: at.to_string(),
            source: Box::new(source),
        })?;
    if let Some(token) = token {
        // The one place the secret is read back out. It has to cross the wire for the server to check
        // it, so what is protected here is everything ELSE — a log line, a `Debug`, a panic message —
        // and `SecretString` is what makes that hold without anyone remembering it.
        let presented = HeaderValue::from_str(&format!("Bearer {}", token.expose_secret()))
            .map_err(|_| ClientError::TokenNotPresentable)?;
        request.headers_mut().insert(
            HeaderName::from_static(cdc_server::listen::auth::AUTHORIZATION),
            presented,
        );
    }
    let (socket, _) = tokio_tungstenite::client_async(request, wire)
        .await
        .map_err(|source| refusal(at, source))?;
    Ok(socket)
}

/// What a failed handshake means, told apart by the status the server answered with.
///
/// A `401` is the token being wrong, and it is the only one worth naming: every other failure is the
/// peer not speaking this protocol, which a client cannot act on beyond reporting it.
fn refusal(at: &str, source: tokio_tungstenite::tungstenite::Error) -> ClientError {
    if let tokio_tungstenite::tungstenite::Error::Http(response) = &source
        && response.status() == tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED
    {
        return ClientError::Unauthorized {
            endpoint: at.to_string(),
        };
    }
    ClientError::Handshake {
        endpoint: at.to_string(),
        source: Box::new(source),
    }
}
