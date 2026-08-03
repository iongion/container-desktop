//! The engine's API over a real socket — `capabilities::http`, natively.
//!
//! Hand-written HTTP/1.1 rather than a client crate, because what the capability asks for is one
//! request over a LOCAL unix socket or named pipe with no redirects, no keep-alive, no middleware and
//! no TLS. A client crate would bring a connection pool, a URL parser and a TLS stack to send
//! `GET /_ping`, and every one of its features would be a surface this port has to decide about —
//! including the ability to open a network connection, which nothing here wants.
//!
//! `Connection: close` is what removes the need for `Content-Length`: the engine closes when it is
//! done, so end-of-stream IS end-of-body. That is the whole reason this is small enough to
//! hand-write, and the reason it must never grow a second request on one connection.
//!
//! **It does not remove chunked framing, and assuming it did was a bug.** Measured against a live
//! Docker Desktop on Windows 11: `GET /_ping` over `\\.\pipe\dockerDesktopLinuxEngine` answers `200`
//! with a CHUNKED body — the bytes on the wire are `2\r\nOK\r\n0\r\n\r\n`, not `OK`. Podman answers
//! `OK` bare, and Docker on a Linux unix socket sends `Content-Length: 2`, so nothing on the original
//! platforms ever showed it; the readiness rule is `body == "OK"`, so a healthy Docker Desktop would
//! have reported itself down. Chunked is ordinary HTTP/1.1 and a client that speaks HTTP/1.1 has to
//! decode it, whatever the engine's reason for choosing it.
//!
//! **There is exactly ONE body decoder, and the whole-response call is written in terms of the
//! streaming one.** A second copy for the buffered case is how the two would come to disagree about
//! framing, which is precisely the defect above arriving twice.
//!
//! What this client OWNS on the wire, and therefore ignores if a caller sends it: `Connection`,
//! `Content-Length` and `Transfer-Encoding`. A caller-supplied length that disagrees with the bytes is
//! request smuggling, and a caller-supplied `Connection` would break the framing rule this module
//! rests on. Everything else the caller asked for is sent verbatim — `Host`, `Accept` and
//! `Content-Type` are the DIALECT's knowledge, so they arrive as headers rather than being
//! decided here.

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use async_trait::async_trait;
use cdc_runtime::capabilities::http::{
    Endpoint, Http, HttpError, HttpHeader, HttpRequest, HttpResponse, HttpStream, HttpStreamOpen,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};

/// `timeout: 3000` — what the oracle gives the engine to answer (`Api.clients.ts:getApiConfig`).
///
/// A readiness check that can hang is a connection attempt that can hang, and the caller is a UI.
/// Applied only when the request names no timeout of its own, and never to a stream.
const REQUEST_TIMEOUT: Duration = Duration::from_millis(3000);

/// The `Host` header sent when the caller names none.
///
/// A unix socket has no hostname and HTTP/1.1 requires the header, so the oracle's `http://d` base URL
/// supplies the same placeholder. A connection that knows its own `api.baseURL` sends that instead,
/// which is the header the daemon actually expects (`http://localhost` for Docker and Apple).
const PLACEHOLDER_HOST: &str = "d";

/// How much to ask the socket for at a time. One page: an engine's `/_ping` fits several times over,
/// and a log follow is bounded by what has arrived rather than by this.
const READ_CHUNK: usize = 4096;

/// The largest head this client reads before it stops calling the reply HTTP.
///
/// Node's own parser is the oracle: `--max-http-header-size` defaults to 16 KiB and axios goes through
/// it, so a head refused here is a head the original refuses too. What it buys is the only bound
/// [`Http::stream`] can have at all — that call is deliberately untimed, so a peer that keeps sending
/// and never sends the blank line is otherwise read forever, into a buffer that grows the whole time.
pub const MAX_HEAD_BYTES: usize = 16 * 1024;

/// The largest body [`Http::request`] holds, past which the caller wanted [`Http::stream`].
///
/// **The original has no cap** — axios leaves `maxContentLength` at `-1` — and this one answers a
/// question the original's runtime answers for it: a whole-response read is an accumulator, and an
/// accumulator with no bound is how a process is made to allocate the machine. It is measured in this
/// tree's own suite, where the same unbounded `while let` took 11 GB and killed the run it was in
/// (`tests/http/main.rs`'s `drain` says so). **The deadline above the loop bounds TIME, not memory**,
/// and three seconds of a local socket is gigabytes.
///
/// 64 MiB is chosen against what an engine ANSWERS rather than against what it can stream: the largest
/// measured in this port is `/v1.40/info` at 2.5 KB, and `/images/json` on a full host is single-digit
/// MB. A reply that genuinely does not fit is a feed, which is what the other call is for.
pub const MAX_RESPONSE_BYTES: usize = 1 << 26;

/// The headers this client writes itself, and therefore drops from what a caller asked for.
const CLIENT_OWNED_HEADERS: [&str; 3] = ["connection", "content-length", "transfer-encoding"];

#[derive(Debug, Default)]
pub struct TokioHttp;

impl TokioHttp {
    /// Dial the endpoint, send the request, and read as far as the end of the head.
    ///
    /// Everything both calls share. What differs afterwards is only whether the caller wants the body
    /// collected for them.
    async fn open(&self, request: &HttpRequest) -> Result<HttpStreamOpen, HttpError> {
        match &request.endpoint {
            #[cfg(unix)]
            Endpoint::UnixSocket(path) => {
                let stream = tokio::net::UnixStream::connect(path)
                    .await
                    .map_err(|error| unreachable(&request.endpoint, &error))?;
                exchange(stream, request).await
            }
            #[cfg(windows)]
            Endpoint::NamedPipe(path) => {
                let client = open_named_pipe(&request.endpoint, path).await?;
                exchange(client, request).await
            }
            // What is left is a transport this BUILD cannot speak, and the two reasons differ.
            //
            // A unix socket on Windows and a named pipe on POSIX are each the other platform's, and
            // `tokio` has no type for them here at all — the `cfg` arms above are the whole story.
            // Refused rather than reported unreachable: "not reachable" would say the engine is down
            // when the truth is that this host cannot dial that kind of address.
            //
            // A command, whose stdin and stdout ARE the connection. Portable — there is no `cfg` here
            // and there must not be: spawning a process is something every host does, and the thing
            // that differs by platform (that the launcher is `wsl.exe`) was decided upstream, in
            // `domain::wsl_args`, where a gate can execute it.
            Endpoint::Stdio(argv) => {
                let child = spawn_dial_stdio(&request.endpoint, argv)?;
                exchange(child, request).await
            }
            // TCP is refused on every target, for a stronger reason: **no caller produces one.**
            // `api_endpoint` resolves an engine address to a socket or a pipe and nothing else, so a
            // dialler here would add outbound network reach to this host that nothing in the port
            // asks for — new egress derived from a settings string. It stays unimplemented until a
            // caller exists, and then as its own decision.
            other => Err(HttpError::Unsupported(other.clone())),
        }
    }
}

#[async_trait]
impl Http for TokioHttp {
    async fn request(&self, request: &HttpRequest) -> Result<HttpResponse, HttpError> {
        let timeout = request.timeout.unwrap_or(REQUEST_TIMEOUT);
        let collect = async {
            let mut open = self.open(request).await?;
            let body =
                collect_body(&request.endpoint, open.body.as_mut(), MAX_RESPONSE_BYTES).await?;
            Ok(HttpResponse {
                status: open.status,
                status_text: open.status_text,
                headers: open.headers,
                body,
            })
        };
        match tokio::time::timeout(timeout, collect).await {
            Ok(answer) => answer,
            Err(_) => Err(HttpError::Unreachable {
                endpoint: request.endpoint.clone(),
                reason: format!("no answer within {}ms", timeout.as_millis()),
            }),
        }
    }

    /// Deliberately UNTIMED, and `request.timeout` is ignored rather than honoured.
    ///
    /// A container log or an `/events` follow is idle most of its life. A read deadline aborts it and
    /// the caller reconnects, so the "stream" becomes a poll loop that costs an engine connection per
    /// cycle — `applyProxyRequestDefaults` forces `timeout = 0` for exactly this reason. What bounds a
    /// stream is the caller dropping it.
    async fn stream(&self, request: &HttpRequest) -> Result<HttpStreamOpen, HttpError> {
        self.open(request).await
    }
}

/// Everything a whole-response read takes from a body, and the two ways it refuses.
///
/// **Extracted out of [`Http::request`] because it is a DECISION that sat where no gate could execute
/// it** — inside an `async` block, over a body this module always builds itself, so nothing could hand
/// it the case it exists for. The same move [`is_pipe_busy`] is, and the same one the listener's
/// `accepted` is: the rule becomes ordinary tested code and only the I/O stays where it has to be.
///
/// `most` is a parameter for the reason `Shared::with_handshake_timeout`'s deadline is one — the
/// production value is [`MAX_RESPONSE_BYTES`], and a test that had to build 64 MiB to reach a boundary
/// would be measuring an allocator instead of the rule.
///
/// Both refusals are the same shape: a body that will not END. That is what a caller gets for sending
/// a follow request — `/events`, `logs?follow=1` — through the call that reads one whole answer.
pub async fn collect_body(
    endpoint: &Endpoint,
    body: &mut dyn HttpStream,
    most: usize,
) -> Result<String, HttpError> {
    // Bytes until the end, then decoded ONCE. Decoding per chunk corrupts a multi-byte character that
    // straddles a chunk boundary — each half is separately invalid, so a container name with an accent
    // in it comes back as two U+FFFDs whether or not the body was ever binary.
    let mut collected: Vec<u8> = Vec::new();
    while let Some(chunk) = body.next_chunk().await? {
        // Neither of the two answers the contract has: not data, and not the end. Taking it would mean
        // coming straight back for the next piece of a body with nothing left to give — and doing it
        // without awaiting anything, so the deadline wrapping this cannot fire. A `SocketBody` never
        // produces one, so what this refuses is a body that is not keeping the contract.
        if chunk.is_empty() {
            return Err(HttpError::Malformed {
                endpoint: endpoint.clone(),
                reason: "a body chunk with nothing in it".to_string(),
            });
        }
        // Asked BEFORE the push, so the refusal costs no allocation of its own: overshooting by a
        // whole chunk and then complaining about the size is the thing this is here to prevent.
        if collected.len() + chunk.len() > most {
            return Err(HttpError::TooLarge {
                endpoint: endpoint.clone(),
                reason: format!("a body past {most} bytes"),
            });
        }
        collected.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&collected).into_owned())
}

/// `ERROR_PIPE_BUSY` — every instance of the pipe already has a client.
///
/// Not an absence and not a failure: the engine is there and saturated. Windows' own answer is to wait,
/// and `CreateFileW` returning this is the documented signal to retry rather than give up.
const ERROR_PIPE_BUSY: i32 = 231;

/// How long to leave a saturated pipe before asking again. Bounded by whatever wraps the exchange —
/// for a request that is [`REQUEST_TIMEOUT`], and for a stream it is the caller.
///
/// Behind the `cfg` while [`is_pipe_busy`] is not, and the split is the point: a pause is a knob, a
/// predicate is a rule. Only the rule has to be executable by a gate.
#[cfg(windows)]
const PIPE_BUSY_RETRY: Duration = Duration::from_millis(50);

/// Whether a failed connect means "wait, the engine is there" rather than "give up".
///
/// **Deliberately NOT behind `cfg(windows)`, even though only Windows can produce this error.** This
/// is the whole decision — a pipe with every instance taken is a HEALTHY engine under load, and
/// answering `Unreachable` there reports it down, which is the same mistake `is_file_present` used to
/// make by deciding presence with an open. A decision compiled on one platform only is a decision no
/// gate here can see: `cargo mutants` still generates mutants for it, nothing on Linux compiles it, so
/// every one of them survives as MISSED and `==` could quietly become `!=` forever. Kept portable, so
/// the rule is ordinary tested code and only the I/O call below is platform-bound.
pub fn is_pipe_busy(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(ERROR_PIPE_BUSY)
}

/// Connect to a named pipe, waiting out the instances rather than calling a busy engine dead.
///
/// The retry is what makes this a readiness probe rather than a coin flip; [`is_pipe_busy`] holds the
/// rule and is tested. What is left here is the connect itself, which no gate on this machine can
/// execute — `cargo check --target x86_64-pc-windows-gnu` proves it COMPILES, and `win11` proves it
/// works.
#[cfg(windows)]
async fn open_named_pipe(
    endpoint: &Endpoint,
    path: &str,
) -> Result<tokio::net::windows::named_pipe::NamedPipeClient, HttpError> {
    loop {
        match tokio::net::windows::named_pipe::ClientOptions::new().open(path) {
            Ok(client) => return Ok(client),
            Err(error) if is_pipe_busy(&error) => {
                tokio::time::sleep(PIPE_BUSY_RETRY).await;
            }
            Err(error) => return Err(unreachable(endpoint, &error)),
        }
    }
}

/// Start the bridge and take its pipes — the whole of what `Endpoint::Stdio` needs from the host.
///
/// **`kill_on_drop` is load-bearing.** [`SocketBody`] owns the stream, so a client that navigates away
/// from a log view drops the body — and for every other transport that closes a socket and is the end
/// of it. A child process would instead be left running, holding a `wsl.exe` and whatever it started
/// inside the distribution, once per abandoned stream. Dropping has to kill it, and tokio only does
/// that if it is asked here.
///
/// Stderr is CAPTURED rather than inherited or discarded. Inherited, it would print into whatever is
/// drawing the screen; discarded, the one failure this transport actually has — a distribution that is
/// not there — arrives as a clean EOF and reads as "the engine closed without a reply", which sends
/// whoever is debugging to look at the engine instead of at the sentence that already explained it.
fn spawn_dial_stdio(endpoint: &Endpoint, argv: &[String]) -> Result<ChildStdio, HttpError> {
    // An argv with no program is not something to report the engine down for — there is nothing to
    // run, which is a claim about the request rather than about the world.
    let Some((program, arguments)) = argv.split_first() else {
        return Err(HttpError::Unsupported(endpoint.clone()));
    };
    let mut child = tokio::process::Command::new(program)
        .args(arguments)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| unreachable(endpoint, &error))?;
    let (stdin, stdout, stderr) = pipes(&mut child, endpoint)?;
    // Drained by its own task rather than read at the end: a bridge that writes more to stderr than
    // the pipe buffer holds would block on that write forever, and the exchange would hang on a
    // diagnostic nobody had asked for yet.
    let said = tokio::spawn(async move {
        let mut text = String::new();
        let _ = tokio::io::BufReader::new(stderr)
            .read_to_string(&mut text)
            .await;
        text
    });
    Ok(ChildStdio {
        _child: child,
        stdin,
        stdout,
        said: Some(said),
        answered: false,
        printed: Vec::new(),
    })
}

/// The three handles a bridge is spoken to through.
pub type BridgePipes = (
    tokio::process::ChildStdin,
    tokio::process::ChildStdout,
    tokio::process::ChildStderr,
);

/// Take the child's three pipes, or report the transport as having failed to start.
///
/// **Public and unit-tested for the reason [`is_pipe_busy`] and [`collect_body`] are: it is a rule
/// that sat where no gate could execute it.** `spawn_dial_stdio` asks for all three, so an absent
/// handle would mean tokio changed what `piped()` promises — a case nothing in this port can produce
/// and therefore one no test could ever hand it while it lived inside the spawn. A child started with
/// any of the three inherited or discarded is what asks it, and only a caller outside this module can
/// build one.
///
/// It is not a recovery: a bridge with no pipe to speak down cannot be spoken down, so this is
/// reported like any other failure to start rather than worked around.
pub fn pipes(
    child: &mut tokio::process::Child,
    endpoint: &Endpoint,
) -> Result<BridgePipes, HttpError> {
    let (Some(stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return Err(HttpError::Unreachable {
            endpoint: endpoint.clone(),
            reason: "the bridge started without the pipes it was given".to_string(),
        });
    };
    Ok((stdin, stdout, stderr))
}

/// One child process, as a single stream.
///
/// The two halves are separate handles — `AsyncRead` is its stdout and `AsyncWrite` is its stdin —
/// which is the whole reason this type exists: `exchange` takes ONE stream, because for every other
/// transport there is one. A bridge is the case where the read end and the write end are different
/// objects, and joining them here is what keeps the HTTP above it written once.
struct ChildStdio {
    /// Held ONLY for its `kill_on_drop`, which is why it is underscored: nothing reads it, and that is
    /// the point — dropping this struct is what kills the bridge. Never awaited either, because whether
    /// the child exited cleanly is not a question this client asks: the ANSWER is the bytes it sent.
    _child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    /// The task draining the child's stderr, which RESOLVES to everything it said.
    ///
    /// A handle rather than a shared buffer, and the difference is a race that cost a test: a buffer
    /// sampled the moment stdout reports end-of-stream is usually still EMPTY, because the drain task
    /// has not been scheduled since the child exited. Awaiting the handle instead asks the question
    /// that has an answer — stderr is closed by then, so it completes at once.
    said: Option<tokio::task::JoinHandle<String>>,
    /// Whether a single byte has come back yet. What tells a bridge that FAILED from one that answered
    /// and then finished — the difference between a reason worth reporting and an ordinary close.
    answered: bool,
    /// What the child printed on stdout while it was dying, accumulated across polls.
    ///
    /// **Only ever filled by [`ChildStdio::explanation`]**, which is reached only once the exchange has
    /// already failed — so it can never take a byte the response reader was going to want. Across polls
    /// because a drain can be interrupted, and starting again would lose the half already in hand.
    printed: Vec<u8>,
}

impl ChildStdio {
    /// The child's own account of why it is gone: what it PRINTED, and failing that what it complained
    /// about.
    ///
    /// **Reached from BOTH halves, because a bridge that dies has two ways of telling us.** If it exits
    /// before reading, the request write fails with `EPIPE`; if it exits after reading and says nothing,
    /// the response read hits end-of-stream. Reporting "Broken pipe" or "closed without a reply"
    /// instead sends whoever is debugging to the engine when the answer was already printed.
    ///
    /// **STDOUT is asked FIRST, and that is not an ordering preference.** `wsl.exe` — the engine this
    /// whole type exists for — reports its failures down the DATA channel in UTF-16LE and never on
    /// stderr, and a missing distribution makes it exit AT ONCE, which is precisely the timing that
    /// takes the `EPIPE` branch. So a reason looked for on stderr alone is a reason that is missing
    /// exactly when the commonest failure this bridge has occurs: whether the sentence survived came
    /// down to whether a ~60-byte write beat the child's exit, and on a loaded machine it does not.
    /// [`readable`] is applied for the same reason it is applied to a head — the bytes are UTF-16LE.
    fn explanation(&mut self, context: &mut Context<'_>) -> Poll<Option<String>> {
        // Everything still in the child's stdout. A child that produced `EPIPE` has exited, so this is
        // already in the pipe and the loop reaches end-of-stream at once; the request deadline is what
        // bounds the one case where it has not, and there is nothing better to bound it with — a bridge
        // that refuses its stdin and then holds stdout open has said nothing yet BY DEFINITION.
        loop {
            let mut chunk = [0_u8; 512];
            let mut buffer = ReadBuf::new(&mut chunk);
            match Pin::new(&mut self.stdout).poll_read(context, &mut buffer) {
                Poll::Pending => return Poll::Pending,
                // A read error here replaces one failure with another and says nothing about the first,
                // so what has been collected so far is the better answer. Kept as an arm of its own,
                // uncovered, rather than folded into the end-of-stream break beside it: a pipe this
                // process owns and has already seen close does not fail to be read, so nothing arranges
                // it — and the condition that would fold the two has a mutant that spins this loop
                // forever instead of failing a test.
                Poll::Ready(Err(_)) => break,
                Poll::Ready(Ok(())) if buffer.filled().is_empty() => break,
                Poll::Ready(Ok(())) => self.printed.extend_from_slice(buffer.filled()),
            }
        }
        let printed = readable(&String::from_utf8_lossy(&self.printed))
            .trim()
            .to_string();
        if !printed.is_empty() {
            return Poll::Ready(Some(printed));
        }
        // What makes this idempotent, which `AsyncRead` and `AsyncWrite` both allow a caller to need:
        // polling a `JoinHandle` that has already answered PANICS. Nothing reaches it today — both
        // callers end the exchange on the first answer — and it is kept for the same reason
        // `SocketBody::finished` is: the alternative to an untaken branch here is a panic in a client.
        let Some(said) = self.said.as_mut() else {
            return Poll::Ready(None);
        };
        let text = match Pin::new(said).poll(context) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(joined) => joined.unwrap_or_default(),
        };
        self.said = None;
        let text = text.trim().to_string();
        Poll::Ready((!text.is_empty()).then_some(text))
    }
}

impl AsyncRead for ChildStdio {
    /// Read the child's stdout, and turn a silent death into the reason it left on stderr.
    ///
    /// **Only before anything has been read.** Once the child has answered, end-of-stream is just
    /// end-of-body — `Connection: close` framing, the same as a socket — and turning that into an
    /// error would fail every successful request whose bridge had written a warning.
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        let before = buffer.filled().len();
        let polled = Pin::new(&mut this.stdout).poll_read(context, buffer);
        let Poll::Ready(Ok(())) = &polled else {
            return polled;
        };
        if buffer.filled().len() > before {
            this.answered = true;
            return polled;
        }
        if this.answered {
            return polled;
        }
        // Nothing came back at all, so the child's own explanation is the only thing left to report.
        // It died SILENTLY if there is none, and `Malformed`'s "closed without a reply" is then the
        // honest answer — which is what letting the empty read stand produces.
        match this.explanation(context) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(None) => polled,
            Poll::Ready(Some(said)) => Poll::Ready(Err(std::io::Error::other(said))),
        }
    }
}

impl AsyncWrite for ChildStdio {
    /// Write to the child's stdin, and turn a bridge that has already exited into the reason it did.
    ///
    /// A broken pipe here means the child was gone before the request finished going out — the failure
    /// mode of `wsl.exe` against a distribution that is not there, which exits at once. `EPIPE` is a
    /// true description of the pipe and a useless one for a person.
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let this = self.get_mut();
        let written = Pin::new(&mut this.stdin).poll_write(context, bytes);
        let Poll::Ready(Err(error)) = &written else {
            return written;
        };
        // No `answered` check, deliberately: `exchange` writes the whole request BEFORE it reads a
        // byte, so nothing has answered while this runs. A guard for it would be a branch no caller can
        // reach, which is a branch nobody can test.
        //
        // A failure that is not the pipe losing its reader is not the child dying, so it is not asked
        // why — and it gets the same answer as a child that died with nothing to say, because in both
        // cases the write's own error is the best there is. One arm, because it is one rule.
        match (error.kind() == std::io::ErrorKind::BrokenPipe).then(|| this.explanation(context)) {
            Some(Poll::Pending) => Poll::Pending,
            Some(Poll::Ready(Some(said))) => Poll::Ready(Err(std::io::Error::other(said))),
            Some(Poll::Ready(None)) | None => written,
        }
    }

    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().stdin).poll_flush(context)
    }

    /// Close the child's stdin, which is how a bridge is told the request is complete.
    ///
    /// **Nothing in this client calls it, and that is the transport's rule rather than an omission:**
    /// `exchange` does not half-close after the request on a bridge any more than it does on a socket,
    /// where `Connection: close` means the SERVER closes — a child told its request is over would be
    /// told the same about a streamed response it has not finished relaying. `AsyncWrite` requires the
    /// method, so what is here is the answer for the day something does call it, and delegating is what
    /// makes that answer right: closing the handle is `Drop`'s job, and this is the only way to ask for
    /// it earlier. It is three uncovered lines for exactly that reason.
    fn poll_shutdown(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().stdin).poll_shutdown(context)
    }
}

/// Write the request and read as far as the blank line, leaving the body to the reader.
///
/// Generic over the stream rather than taking a `UnixStream`: what happens after a connection is made
/// is the same for any of them, and keeping it that way is what makes a second transport a connect
/// plus a caller rather than a second copy of the protocol.
async fn exchange<S>(mut stream: S, request: &HttpRequest) -> Result<HttpStreamOpen, HttpError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    stream
        .write_all(wire_format(request).as_bytes())
        .await
        .map_err(|error| unreachable(&request.endpoint, &error))?;
    stream
        .flush()
        .await
        .map_err(|error| unreachable(&request.endpoint, &error))?;
    let mut body = SocketBody::over(stream, request.endpoint.clone());
    let head = body.read_head().await?;
    let (status, status_text) = status_line(&request.endpoint, &head)?;
    let headers = header_fields(&head);
    body.chunked = is_chunked(&headers);
    Ok(HttpStreamOpen {
        status,
        status_text,
        headers,
        body: Box::new(body),
    })
}

/// The request as bytes on the wire.
///
/// A body is sent with `Content-Length` and no `Transfer-Encoding`: the engine APIs accept JSON that
/// way and chunked framing would be a second encoding to get right for no gain.
fn wire_format(request: &HttpRequest) -> String {
    let mut wire = format!("{} {} HTTP/1.1\r\n", request.method, request.path);
    if !names_host(&request.headers) {
        wire.push_str(&format!("Host: {PLACEHOLDER_HOST}\r\n"));
    }
    for (name, value) in &request.headers {
        if CLIENT_OWNED_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
            continue;
        }
        wire.push_str(&format!("{name}: {value}\r\n"));
    }
    wire.push_str("Connection: close\r\n");
    let Some(body) = &request.body else {
        wire.push_str("\r\n");
        return wire;
    };
    wire.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));
    wire.push_str(body);
    wire
}

/// Whether the caller supplied its own `Host`, which is the one header a daemon selects on.
fn names_host(headers: &[HttpHeader]) -> bool {
    headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("host"))
}

/// `HTTP/1.1 200 OK` — the code is the second field and the reason phrase is the rest.
///
/// An empty read lands here too, which is what a peer that closed without answering produces, and it
/// is malformed rather than unreachable: the connection was made.
fn status_line(endpoint: &Endpoint, head: &str) -> Result<(u16, String), HttpError> {
    let line = head.lines().next().unwrap_or_default();
    let mut fields = line.splitn(3, ' ');
    let status = fields
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| HttpError::Malformed {
            endpoint: endpoint.clone(),
            reason: if line.is_empty() {
                "closed without a reply".to_string()
            } else {
                format!("no status code in {:?}", readable(line))
            },
        })?;
    Ok((status, fields.next().unwrap_or_default().trim().to_string()))
}

/// Something that is not HTTP, as a PERSON can read it.
///
/// **Measured against a real `wsl.exe` on win11.** A distribution that does not exist is reported on
/// STDOUT — not stderr, which is where the rest of this transport looks — and in UTF-16LE, the same
/// encoding that makes `wsl -l -v` unreadable without PowerShell. So "There is no distribution with
/// the supplied name." arrived with a NUL after every character and reached a person as mojibake: the
/// message was delivered and might as well not have been.
///
/// **This is the same root cause the oracle already works around, in the one place it noticed.**
/// `getAvailableWSLDistributions` wraps the listing in PowerShell to re-encode it — ported here as
/// [`cdc_runtime::runtimes::transports::wsl::distributions_script`] — because `wsl.exe` writes UTF-16LE
/// whatever it is saying. Nobody wrapped the ERROR path, in either tree, because until a bridge existed
/// nothing read `wsl.exe`'s output as a protocol. Wrapping is not available here anyway: PowerShell
/// between this client and the engine would re-encode the DATA too.
///
/// Deliberately a REPAIR of an error string and not a decoder in the read path. The body of a real
/// response is the engine's and is never re-encoded; this runs only where the head has already failed
/// to be HTTP, so the bytes are a diagnostic rather than data. The test is the shape of the rule: more
/// than half the characters are NUL, which no HTTP head and no engine error ever is.
pub fn readable(head: &str) -> String {
    let total = head.chars().count();
    let text: String = head
        .chars()
        .filter(|character| *character != '\0')
        .collect();
    // At least half the characters are NUL, which is what UTF-16LE ASCII looks like decoded as UTF-8 and
    // what no HTTP head and no engine error ever is. A `nulls > 0` guard used to stand in front of this
    // and was redundant — with no NULs the comparison is already false — which is exactly why the
    // mutation gate could not tell `>` from `>=` there.
    if text.chars().count() * 2 <= total {
        return text;
    }
    head.to_string()
}

/// Every `Name: Value` after the status line, in the order they arrived.
///
/// A line with no colon is dropped rather than guessed at: it is an obsolete folded continuation or it
/// is garbage, and neither is a field a client may act on.
fn header_fields(head: &str) -> Vec<HttpHeader> {
    head.lines()
        .skip(1)
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
        .collect()
}

/// Whether the head declares chunked framing.
///
/// `contains` rather than an equality test, because `Transfer-Encoding: gzip, chunked` is legal and
/// chunked is always the last coding applied. Ignoring the field means handing the caller framing
/// bytes and calling them the body.
fn is_chunked(headers: &[HttpHeader]) -> bool {
    headers.iter().any(|(name, value)| {
        name.eq_ignore_ascii_case("transfer-encoding")
            && value.to_ascii_lowercase().contains("chunked")
    })
}

/// The body still on the socket, decoded as it arrives.
///
/// It owns the connection, so dropping it closes it — which is what makes a client that navigates away
/// from a log view cost nothing.
struct SocketBody<S> {
    stream: S,
    endpoint: Endpoint,
    /// Bytes read past the point the caller has consumed. The head read almost always overshoots into
    /// the body, and a chunk header can straddle two reads.
    buffered: Vec<u8>,
    chunked: bool,
    /// Set once the peer closed, or once the zero-length chunk arrived. Answering `None` twice must
    /// not read the socket again.
    finished: bool,
}

impl<S> SocketBody<S>
where
    S: AsyncRead + Unpin + Send,
{
    fn over(stream: S, endpoint: Endpoint) -> Self {
        Self {
            stream,
            endpoint,
            buffered: Vec::new(),
            chunked: false,
            finished: false,
        }
    }

    /// Read until the blank line, and answer the head with the buffer left holding the body.
    ///
    /// `\n\n` is accepted beside `\r\n\r\n` for the same reason the previous parser accepted it: a
    /// reply that skimps on carriage returns is still one this client can read, and refusing it would
    /// report a working engine as speaking something that is not HTTP.
    async fn read_head(&mut self) -> Result<String, HttpError> {
        loop {
            if let Some((head, rest)) = split_head(&self.buffered) {
                self.buffered = rest;
                return Ok(head);
            }
            // Asked before the next read rather than after it, because what this bounds is a peer that
            // keeps sending and never sends the blank line. It is the ONE bound a stream open has:
            // `stream` carries no deadline, so nothing else here ever stops reading.
            if self.buffered.len() > MAX_HEAD_BYTES {
                return Err(self.malformed(&format!(
                    "a head with no blank line in {MAX_HEAD_BYTES} bytes"
                )));
            }
            if !self.fill().await? {
                // Everything there is, with no blank line in it. `status_line` decides what that
                // means — an empty read is a peer that hung up, anything else is not HTTP. Taken
                // rather than left, so a head that turns out to be readable is not served again as
                // though it were body. Decoded here because a HEAD is text by spec, unlike a body.
                return Ok(String::from_utf8_lossy(&self.take_buffered()).into_owned());
            }
        }
    }

    /// Read once more. `false` means the peer closed.
    async fn fill(&mut self) -> Result<bool, HttpError> {
        let mut page = [0_u8; READ_CHUNK];
        let read = self
            .stream
            .read(&mut page)
            .await
            .map_err(|error| unreachable(&self.endpoint, &error))?;
        if read == 0 {
            return Ok(false);
        }
        self.buffered.extend_from_slice(&page[..read]);
        Ok(true)
    }

    /// Everything buffered, as the caller's next chunk.
    fn take_buffered(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.buffered)
    }

    /// The next piece of an unframed body: whatever has arrived, until the peer closes.
    async fn next_raw(&mut self) -> Result<Option<Vec<u8>>, HttpError> {
        if !self.buffered.is_empty() {
            return Ok(Some(self.take_buffered()));
        }
        if !self.fill().await? {
            self.finished = true;
            return Ok(None);
        }
        Ok(Some(self.take_buffered()))
    }

    /// The next piece of a chunked body — `<hex size>[;ext]\r\n<data>\r\n`, terminated by a
    /// zero-length chunk (RFC 9112).
    ///
    /// A frame that does not decode is [`HttpError::Malformed`] rather than passed on, because a body
    /// the client cannot decode is one it must not hand to a caller that will compare it against
    /// `"OK"` or reassemble it into a log. Trailers after the final chunk are ignored, as they are for
    /// every request this client makes.
    async fn next_chunked(&mut self) -> Result<Option<Vec<u8>>, HttpError> {
        loop {
            if let Some(frame) = self.decode_chunk()? {
                return Ok(frame);
            }
            if !self.fill().await? {
                self.finished = true;
                return Err(self.malformed("a chunked body that ended mid-frame"));
            }
        }
    }

    /// One frame out of what is buffered, if a whole one is there.
    ///
    /// Three answers rather than two: `None` is "not yet, read more", `Some(None)` is the terminator
    /// and `Some(Some(_))` is data. Collapsing the first two would make a short read indistinguishable
    /// from the end of the body.
    fn decode_chunk(&mut self) -> Result<Option<Option<Vec<u8>>>, HttpError> {
        let Some(end_of_header) = find(&self.buffered, b"\r\n") else {
            return Ok(None);
        };
        let header = String::from_utf8_lossy(&self.buffered[..end_of_header]).into_owned();
        let size = usize::from_str_radix(header.split(';').next().unwrap_or_default().trim(), 16)
            .map_err(|_| {
            self.malformed(&format!("a chunk size that is not hexadecimal: {header:?}"))
        })?;
        if size == 0 {
            // The terminator, and whatever trailers followed it. Both are dropped: nothing this
            // client sends asks for a trailer, and leaving them buffered would hand the framing bytes
            // to the next caller as if they were body.
            self.finished = true;
            self.buffered.clear();
            return Ok(Some(None));
        }
        // Past the header's CRLF, the data, and the CRLF that closes the chunk.
        let start = end_of_header + 2;
        if self.buffered.len() < start + size + 2 {
            return Ok(None);
        }
        let data = self.buffered[start..start + size].to_vec();
        self.buffered.drain(..start + size + 2);
        Ok(Some(Some(data)))
    }

    fn malformed(&self, reason: &str) -> HttpError {
        HttpError::Malformed {
            endpoint: self.endpoint.clone(),
            reason: reason.to_string(),
        }
    }
}

#[async_trait]
impl<S> HttpStream for SocketBody<S>
where
    S: AsyncRead + Unpin + Send,
{
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, HttpError> {
        // Terminal in both directions: a peer that closed must not be read again, and the zero-length
        // chunk means the engine is done however much of the socket is left.
        if self.finished {
            return Ok(None);
        }
        if self.chunked {
            return self.next_chunked().await;
        }
        self.next_raw().await
    }
}

/// The head and whatever followed it, once the blank line has arrived.
///
/// The EARLIEST blank line wins, whichever of the two spellings it is. Written as a search over both
/// candidates rather than as a comparison of their positions, because the two can never land on the
/// same index — `\r\n\r\n` holds no two consecutive newlines — so a hand-written `lf < crlf` carries a
/// tie case that no input can reach, and an unreachable comparison is a mutant that cannot be killed.
fn split_head(buffered: &[u8]) -> Option<(String, Vec<u8>)> {
    let (at, width) = [
        (find(buffered, b"\r\n\r\n"), 4),
        (find(buffered, b"\n\n"), 2),
    ]
    .into_iter()
    .filter_map(|(at, width)| at.map(|at| (at, width)))
    .min_by_key(|(at, _)| *at)?;
    Some((
        String::from_utf8_lossy(&buffered[..at]).into_owned(),
        buffered[at + width..].to_vec(),
    ))
}

/// Where `needle` first appears in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Nothing was listening, or the connection died mid-exchange — one shape for all of it, because the
/// caller's question is only whether the engine answered.
fn unreachable(endpoint: &Endpoint, error: &std::io::Error) -> HttpError {
    HttpError::Unreachable {
        endpoint: endpoint.clone(),
        reason: error.to_string(),
    }
}
