//! A client of the connection server, and the three ways of reaching one.
//!
//! **This is a client's only way into the core**, and the reason is not performance: a
//! terminal that could only talk to an in-process core could never attach to a server on another
//! machine, and a second way in would drift from the first until somebody tried. So embedded mode is a
//! transport — an in-process pipe carrying a real WebSocket handshake and real JSON envelopes into the
//! real [`cdc_server::listen::session::serve`] — rather than a shortcut past the protocol.
//!
//! **What that buys is checkable rather than argued.** A frame that the remote transport would refuse
//! is refused by the embedded one too, because the code that refuses it is the same code; a test says
//! so with the same bytes down both.
//!
//! Errors are named the way the domain names them: what a client cannot tell apart, it does not
//! pretend to. "Nothing is listening" and "you may not" are different answers with different actions,
//! so they are different variants — where the four ways a handshake can be malformed are one.

use std::path::PathBuf;

use cdc_runtime::domain::ssh::forward::is_named_pipe;
use cdc_server::protocol::{Command, Outbound, Request};
use futures_util::{SinkExt, StreamExt};
use secrecy::SecretString;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

pub mod dial;

pub mod embedded;

pub mod tls;

pub mod mux;

/// Where a server is.
///
/// **Embedded is deliberately not a variant.** What the other two carry is an address, and what
/// embedded needs is a server to run — a different kind of thing, constructed differently
/// ([`embedded::attach`]), and a variant would have to hold either a value nobody can write on a
/// command line or a placeholder that means "look elsewhere".
#[derive(Debug, Clone)]
pub enum Endpoint {
    /// The local socket, whose access control is the filesystem's. A named pipe path on Windows.
    Local(PathBuf),
    /// A server across a network, and the bearer token that is the whole of what guards it.
    ///
    /// **The token is not optional here, because it is not optional there**: `listen::Admitted` refuses
    /// to bind a remote listener without one, on loopback as well as off it. A client that could
    /// express a tokenless remote endpoint could only ever express one that is refused.
    Remote {
        /// `host:port`, as `TcpStream::connect` takes it.
        address: String,
        token: SecretString,
        /// What this client will trust the server to be, or `None` to speak in the clear.
        ///
        /// **`None` is a decision the caller made and never a default this reached for.** The token
        /// below is presented in a header on the first frame, so without this it is readable and
        /// replayable by anything on the path — which is correct behind an SSH tunnel and correct
        /// nowhere else. The status bar says which of the two this is (`ws://` against `wss://`),
        /// because it is not something a person should have to remember about their own session.
        tls: Option<tls::ClientTls>,
    },
}

impl Endpoint {
    /// The URL the WebSocket handshake asks for.
    ///
    /// The local socket has no meaningful authority — the path was already dialled — so it sends the
    /// same `localhost` every other client of this protocol does, including the server's own tests.
    ///
    /// **The scheme follows the transport rather than being chosen.** `wss://` where TLS is terminated
    /// under the handshake and `ws://` where it is not, so a proxy or a server reading the request line
    /// is told the same thing the socket is doing.
    pub fn url(&self) -> String {
        match self {
            Self::Local(_) => "ws://localhost/".to_string(),
            Self::Remote { address, tls, .. } => format!("{}://{address}/", scheme(tls.as_ref())),
        }
    }
}

/// `wss` where a certificate is verified, `ws` where nothing is.
fn scheme(tls: Option<&tls::ClientTls>) -> &'static str {
    match tls {
        Some(_) => "wss",
        None => "ws",
    }
}

/// How an endpoint is shown to a person — and it CANNOT show the token, which is the point.
///
/// `SecretString` is not printed by any of this, so a status bar, a log line or a panic message that
/// interpolates an endpoint is safe by construction rather than by review. Asserted.
impl std::fmt::Display for Endpoint {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // The scheme is read off the ADDRESS, never off the target: a local endpoint is a unix
            // socket on POSIX and a NAMED PIPE on Windows, and a chrome line reading `unix:\\.\pipe\…`
            // is a sentence a person acts on. Found by running this terminal on win11.
            Self::Local(path) => {
                let path = path.display().to_string();
                let scheme = if is_named_pipe(&path) { "pipe" } else { "unix" };
                write!(formatter, "{scheme}:{path}")
            }
            Self::Remote { address, tls, .. } => {
                write!(formatter, "{}://{address}", scheme(tls.as_ref()))
            }
        }
    }
}

/// Why a client is not talking to a server.
///
/// **Where it happened is carried as the RENDERED endpoint, not the value**, and that is the mechanism
/// rather than a convenience: [`Endpoint`]'s `Display` cannot print a token, so no error — and nothing
/// built from one, including a panic message — can leak the secret. It is also what lets the embedded
/// transport, which has no address at all, name itself in the same field.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// Nothing answered at that address. The socket is not there, the port is closed, the host is down.
    #[error("no server at {endpoint}: {source}")]
    Unreachable {
        endpoint: String,
        #[source]
        source: std::io::Error,
    },
    /// Something answered and refused the token. **Told apart from every other handshake failure**
    /// because it is the one with an action: fix the token, do not go looking for a server.
    #[error("{endpoint} refused this token")]
    Unauthorized { endpoint: String },
    /// Something answered and this client will not trust what it presented — an unknown issuer, an
    /// expired certificate, a name the certificate is not for.
    ///
    /// **Told apart from [`ClientError::Unreachable`], and that is the whole reason it exists.** The
    /// two are the same `io::Error` underneath and they have opposite actions: one is a server to go
    /// and start, the other is a certificate to go and fix. Reporting an untrusted certificate as an
    /// absent server sends somebody looking for a process that is running perfectly well — **and the
    /// token is not presented in either case**, because this fails below the handshake that would carry
    /// it.
    #[error("{endpoint} presented a certificate this client does not trust: {source}")]
    Untrusted {
        endpoint: String,
        #[source]
        source: std::io::Error,
    },
    /// Something answered and it is not this protocol — or the URL was not one. Boxed because
    /// tungstenite's error carries a whole HTTP response, which would make every variant that size.
    #[error("{endpoint} did not complete a websocket handshake: {source}")]
    Handshake {
        endpoint: String,
        #[source]
        source: Box<tokio_tungstenite::tungstenite::Error>,
    },
    /// A token with bytes that cannot be a header value — a newline from a file read whole, most
    /// likely. Refused before anything is sent, because half a header is a different request.
    #[error("the token cannot be presented as a header: it contains bytes a header value may not")]
    TokenNotPresentable,
    /// The frame did not reach the server. Whatever the socket said, the session is over: this
    /// protocol has no resend, and a client that retried would be guessing whether the first one landed.
    #[error("the connection to the server is gone")]
    Disconnected,
    /// A frame arrived that this client cannot read as the protocol. A server one version ahead, or
    /// something else entirely on the other end of the socket.
    ///
    /// **A new diagnostic CODE is no longer one of the ways here.** It used to be the commonest one:
    /// `DiagnosticCode` was a closed enum, so a code this build had never heard of made the whole
    /// frame undecodable and a person was shown raw JSON instead of a diagnostic. The code type is
    /// open now (`DiagnosticCode::Unknown`), so what is left in here is a frame whose SHAPE this
    /// client does not know — a reply or an event added after this build.
    #[error("the server sent a frame this client cannot read: {frame}")]
    Unreadable { frame: String },
}

/// One connection to one server.
///
/// **Not `Sync`, and one task owns it.** Sending and receiving both take `&mut self`, which is what
/// makes the total order the server guarantees on its side survive on this one — two tasks writing to
/// one socket is exactly the "second path" the design forbids, one layer further out.
pub struct Client {
    socket: WebSocketStream<dial::Wire>,
    /// How many requests this client has issued, which is also the id the next one gets. A sequence
    /// number is what [`Request`] documents as sufficient: the server never interprets it.
    issued: u64,
}

impl Client {
    /// Reach the server at an endpoint: open the stream, then speak the handshake over it.
    pub async fn connect(endpoint: &Endpoint) -> Result<Self, ClientError> {
        let wire = dial::open(endpoint).await?;
        Ok(Self::new(dial::handshake(endpoint, wire).await?))
    }

    /// A client over a stream that has already been handshaked.
    ///
    /// The seam between "how the socket got here" and "what is said over it" — which is where the
    /// three transports stop differing. A caller that speaks the handshake itself, over a stream this
    /// module does not know how to open, gets a client from here.
    pub fn new(socket: WebSocketStream<dial::Wire>) -> Self {
        Self { socket, issued: 0 }
    }

    /// Which transport this client is on. See [`dial::Wire::transport`] for what does and does not
    /// render it: the chrome shows the endpoint's SCHEME, and no screen reads this.
    pub fn transport(&self) -> &'static str {
        self.socket.get_ref().transport()
    }

    /// Issue one command, and answer with the id its reply will carry.
    ///
    /// **The id is returned rather than assumed**, because a client that guessed the next one would be
    /// wrong the moment anything else on this connection issued a command — and correlating a reply is
    /// the only way to know a reply is yours: pushes arrive between a request and its answer.
    pub async fn send(&mut self, command: Command) -> Result<String, ClientError> {
        self.issued += 1;
        let id = self.issued.to_string();
        let request = Request::new(id.clone(), command);
        // A `Request` is derives over `Connection` and `serde_json::Value`, so this cannot fail — and
        // rather than say so in a comment nothing tests, the impossible case takes the same exit as the
        // possible one. Both mean the same thing to a caller: that frame is not going to the server.
        let frame = serde_json::to_string(&request).map_err(|_| ClientError::Disconnected)?;
        self.socket
            .send(Message::text(frame))
            .await
            .map_err(|_| ClientError::Disconnected)?;
        Ok(id)
    }

    /// The next frame the server wrote, or `None` once it has closed the session.
    ///
    /// **Cancel-safe, and the event loop depends on it**: this is one arm of a `select!` against the
    /// terminal's input, and a partially-read frame stays buffered inside the WebSocket rather than
    /// being lost when the other arm wins.
    ///
    /// A clean close answers `None` and a broken connection answers [`ClientError::Disconnected`] —
    /// told apart because "the server is going away" and "the network went" read differently to whoever
    /// is watching, even though neither can be recovered from.
    pub async fn next(&mut self) -> Option<Result<Outbound, ClientError>> {
        loop {
            return match self.socket.next().await? {
                Ok(Message::Text(text)) => {
                    Some(
                        serde_json::from_str(&text).map_err(|_| ClientError::Unreadable {
                            frame: text.to_string(),
                        }),
                    )
                }
                Ok(Message::Close(_)) => None,
                // Ping, pong and binary are tungstenite's business or nobody's: this protocol is text.
                Ok(_) => continue,
                Err(_) => Some(Err(ClientError::Disconnected)),
            };
        }
    }
}
