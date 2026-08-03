//! Reaching the engine's own API — the capability behind "is it actually serving?" and behind every
//! request a client has forwarded through the connection that owns the transport.
//!
//! Two callers, and they are the two the original has. `services.ts:startTunnel` calls a tunnel ready
//! only when `GET /_ping` returns 200, which is what this port's readiness verdict asks. And
//! `commandProxyProtocol.ts` forwards the renderer's engine HTTP to whoever holds the single SSH
//! tunnel, WSL relay or socket — which the server IS.
//!
//! Shaped by what those two do rather than by what an HTTP client can do: no redirects, no
//! keep-alive, no middleware, no cookie jar, no TLS. The engine APIs are plain HTTP/1.1 over a unix
//! socket, a named pipe or a TCP port, and a request builder nobody needs is a surface that can be got
//! wrong.
//!
//! **It grew headers, a status line and a streaming call when the proxy arrived, and every one of
//! those is something an engine API needs rather than something an HTTP client offers.** Docker and
//! Podman both require `Content-Type` on a write; a client rebuilding its own HTTP error needs the
//! status TEXT as well as the code; and container logs, `/events` and attach are streams that cannot
//! cross a request/response boundary whole. What is still refused is everything else.

use std::time::Duration;

use async_trait::async_trait;

/// Where an engine API is listening.
///
/// A value rather than a URL string, because the three cases are genuinely different transports and
/// the settings carry them as different fields — `api.connection.uri` is a path, `api.baseURL` is a
/// URL. Turning them into one string here would only mean parsing them apart again in the host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    /// A unix-domain socket path. The common case on Linux and macOS, and what an SSH forward binds.
    UnixSocket(String),
    /// A Windows named pipe (`\\.\pipe\…`). The common case there, and what an SSH relay serves.
    NamedPipe(String),
    /// `host:port`, for a remote engine exposed over TCP.
    Tcp(String),
    /// A COMMAND whose stdin and stdout are the channel — `<engine> system dial-stdio`, and the argv
    /// that reaches it.
    ///
    /// **The one address kind that is not an address**, and it exists because for some connections
    /// there is no address to have. An engine inside a WSL distribution binds a socket on a filesystem
    /// no Windows process can open, at a path no `CreateFileW` accepts; a podman machine binds one
    /// inside a VM. Neither can be `ssh -NL` forwarded — a distribution is not a host — so the only
    /// thing left is to ask the engine to bridge its own socket to a pipe pair and speak HTTP/1.1 down
    /// that. Docker ships exactly this as `docker system dial-stdio`, and it is why a Docker context
    /// can name a command where another names a socket.
    ///
    /// **`Connection: close` still frames the body**, the same as every other kind: the child exits
    /// when the engine closes, so end-of-stream is still end-of-body. What differs is what "the
    /// connection died" means — a process exited rather than a socket reset — and that a presence
    /// check has nothing to look for, because a command is not a file
    /// ([`crate::domain::machine`]'s `probe_api` says so where it used to look).
    ///
    /// The argv is the WHOLE command including its launcher's arguments, resolved by whoever knew how
    /// to enter the guest — [`crate::domain::wsl_args`] for a distribution. It is carried on the
    /// connection as `api.connection.dialStdioCommand`, which is the original's own field.
    Stdio(Vec<String>),
    /// A CONNECTION to be routed through, for a caller that does not own the transport.
    ///
    /// **The one kind that is not a transport**, and it is still a "where": a forwarded request has no
    /// local address, it has a connection whose owner resolves one — which is what
    /// `payload.connection.id` already is. Its only consumer is
    /// [`crate::command_proxy::ForwardedHttp`]; every host refuses it through the arm that refuses TCP,
    /// because dialling it locally is the thing the forwarding protocol exists to avoid.
    Connection(String),
}

/// One header field, as it travels.
///
/// Ordered PAIRS rather than a map, because that is what HTTP is: the order is observable and a field
/// name may legally repeat. `CommandProxyResponse.headers` is a JSON object only because the
/// original's axios has already collapsed them, and collapsing is the CLIENT's simplification — a
/// capability that performed it here would decide for every client that no header repeats.
pub type HttpHeader = (String, String);

/// One request. `path` includes the query string, exactly as the engine APIs document their routes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub endpoint: Endpoint,
    pub method: String,
    pub path: String,
    /// What to send with it. The engine's own requirements travel here — `Content-Type` on a Docker
    /// or Podman write, and the `Host` the daemon expects — because they are the DIALECT's knowledge
    /// and not the transport's — `baseURL` stays a domain concern.
    pub headers: Vec<HttpHeader>,
    /// A body, when there is one. Not typed further: the engine APIs disagree about shapes and this
    /// layer has no opinion about them.
    pub body: Option<String>,
    /// How long the caller will wait. `None` leaves it to the host's own default, which is the
    /// oracle's `timeout: 3000` (`Api.clients.ts:getApiConfig`).
    ///
    /// **A STREAM is never given one**, and that is a rule rather than an omission: a finite read
    /// timeout aborts an idle log follow after a few seconds, and the "stream" silently degrades into
    /// a reconnect-poll loop. `applyProxyRequestDefaults` states it in the original, and
    /// [`Http::stream`] states it here.
    pub timeout: Option<Duration>,
}

impl HttpRequest {
    /// The readiness question, which is the reason this capability exists.
    ///
    /// Headers are the caller's to add: the `Host` a daemon expects comes from `api.baseURL`, which is
    /// the connection's and not this constructor's.
    pub fn ping(endpoint: Endpoint) -> Self {
        Self {
            endpoint,
            method: "GET".to_string(),
            path: "/_ping".to_string(),
            headers: Vec::new(),
            body: None,
            timeout: None,
        }
    }
}

/// What came back, whole.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    /// The reason phrase from the status line — `OK`, `Not Found`. Carried because
    /// `CommandProxyResponse.statusText` is, and a client rebuilding the error its own HTTP library
    /// would have raised has nowhere else to get it. Empty when the engine sent none, which is legal.
    pub status_text: String,
    pub headers: Vec<HttpHeader>,
    pub body: String,
}

impl HttpResponse {
    /// Whether the engine answered successfully. `2xx`, not `== 200`: Podman answers `204` to some
    /// routes the oracle treats as fine, and a readiness check that insisted on 200 would call a
    /// working engine unavailable.
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

/// A response whose body has not arrived yet — container logs, `/events`, attach.
///
/// The head is delivered at once and the body follows as chunks, which is exactly the split
/// `CommandProxyStreamHandle` makes: it carries `status` and `headers` and then the body arrives as
/// `CommandProxyStreamEvent`s. The fields repeat [`HttpResponse`]'s rather than sharing a `head`
/// struct, because that is the shape the original has on the wire and a concept it does not have
/// needs a reason before it is written.
pub struct HttpStreamOpen {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<HttpHeader>,
    pub body: Box<dyn HttpStream>,
}

impl std::fmt::Debug for HttpStreamOpen {
    /// Hand-written, and the BODY is deliberately absent from it: reading it to print it would consume
    /// the caller's stream. What a failing assertion needs is the head, which is what the engine has
    /// said so far.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HttpStreamOpen")
            .field("status", &self.status)
            .field("status_text", &self.status_text)
            .field("headers", &self.headers)
            .finish_non_exhaustive()
    }
}

/// The body of a streamed response, chunk by chunk.
///
/// Mirrors [`StreamHandle`](crate::capabilities::command::StreamHandle), which is the same shape for
/// a process's output — one `next_chunk` a caller drives, rather than a callback the capability
/// invokes. The three answers are the three the wire protocol already has: `Ok(Some)` is
/// `StreamEventType::Data`, `Ok(None)` is `End`, and `Err` is `Error`, all three terminal in the same
/// places the original's emitter is.
///
/// **`Ok(Some)` carries at least one byte.** A node stream does not emit an empty `data` event and
/// neither does the body this port's native host builds — a zero-length read is the END of an unframed
/// body and a zero-length chunk is the terminator of a framed one, so an empty piece is neither of the
/// two answers it could be. Said here because a whole-response read that took one would come back for
/// the next piece of a body with nothing left to give, and it would do it without ever awaiting: a spin
/// rather than a wait, which no deadline above it can interrupt.
///
/// **Dropping this closes the underlying connection.** A client that navigates away from a log view
/// leaks an engine connection otherwise, which the design names.
///
/// **Bytes, not text.** A container log is multiplexed into frames whose 8-byte header ends in a
/// big-endian length, so a payload of 128 bytes puts `0x80` on the wire — not valid UTF-8. Decoding
/// here would replace it with U+FFFD, which is three bytes where there was one, and the framing
/// becomes unrecoverable rather than merely mangled. A caller that wants text decodes with
/// [`crate::domain::logs`]; this carries what arrived.
#[async_trait]
pub trait HttpStream: Send {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, HttpError>;
}

#[derive(Debug, thiserror::Error)]
pub enum HttpError {
    /// Nothing was listening, the connection was refused, or it was reset mid-request. The engine's
    /// availability answer, and the shape a stale forward socket produces.
    #[error("{endpoint:?} is not answering: {reason}")]
    Unreachable { endpoint: Endpoint, reason: String },
    /// It answered, but not with HTTP.
    #[error("{endpoint:?} answered something that is not HTTP: {reason}")]
    Malformed { endpoint: Endpoint, reason: String },
    /// It answered with more than a whole-response read will hold.
    ///
    /// Its own variant because both other readings would be FALSE in a log: the endpoint is answering,
    /// and what it answered is HTTP. A body that does not end is a feed, and [`Http::stream`] is the
    /// call for a feed — this is what a caller gets for sending `/events` or `logs?follow=1` through
    /// the one that reads a whole answer.
    #[error("{endpoint:?} answered more than one response can hold: {reason}")]
    TooLarge { endpoint: Endpoint, reason: String },
    /// The transport cannot be used on this host — a named pipe asked of a POSIX host, say. A refusal
    /// rather than a panic, because which endpoints exist is the host's answer, not the caller's.
    #[error("{0:?} is not a transport this host speaks")]
    Unsupported(Endpoint),
}

/// The engine API, as the two calls its two callers make.
#[async_trait]
pub trait Http: Send + Sync {
    /// One request, one whole response. What readiness asks, and what every non-streaming forwarded
    /// request is.
    async fn request(&self, request: &HttpRequest) -> Result<HttpResponse, HttpError>;

    /// One request, and a body that arrives over time.
    ///
    /// `request.timeout` is IGNORED here on purpose — see the field. A stream is bounded by the caller
    /// dropping it, never by a read deadline.
    async fn stream(&self, request: &HttpRequest) -> Result<HttpStreamOpen, HttpError>;
}
