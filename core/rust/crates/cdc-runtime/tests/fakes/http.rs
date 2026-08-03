//! The engine's own API, faked — `capabilities::http::Http`.
//!
//! A child of [`super`] because that file reached the 620-line cap, and this is the seam it has:
//! everything here answers HTTP, where the parent answers processes, the filesystem and the clock.
//! Re-exported by the parent, so every existing `fakes::FakeHttp` still resolves.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cdc_runtime::capabilities::http::{
    Http, HttpError, HttpRequest, HttpResponse, HttpStream, HttpStreamOpen,
};

/// One request, answered. Boxed rather than a `fn` pointer for the same reason [`Respond`] is: a
/// script may COUNT, which is how an engine that answers and then stops gets expressed.
pub type Ping = Box<dyn Fn(&HttpRequest) -> Result<HttpResponse, HttpError> + Send + Sync>;

/// A streamed body chosen by the request — the chunks one call delivers, in order.
pub type StreamBody = Box<dyn Fn(&HttpRequest) -> Vec<Vec<u8>> + Send + Sync>;

/// The engine's own API, scripted — `capabilities::http::Http`.
///
/// It RECORDS what it was asked, because "did the engine answer" is only half the question: for a
/// scoped connection the ADDRESS matters just as much, and the one that must be pinged is the local
/// relay rather than anything in the guest. A fake that only returned a verdict could not tell a test
/// which of those was reached — nor, now, which HEADERS it was asked with, which is what selects the
/// daemon's own idea of who it is talking to.
pub struct FakeHttp {
    answer: Ping,
    /// What a STREAMED body delivers, in order. The head is [`FakeHttp::answer`]'s, so one script
    /// describes both calls and they cannot disagree about the status.
    ///
    /// BYTES, so a fixture can carry the `0x80`-and-above a container log frame's length header puts
    /// on the wire. An all-ASCII one cannot tell a byte-faithful reader from a decoding one.
    chunks: Vec<Vec<u8>>,
    /// Whether the stream dies instead of ending cleanly, which is the only way to reach the wire
    /// protocol's `error` event.
    breaks: bool,
    /// Whether a stream is never ANSWERED at all — see [`FakeHttp::silent_stream`]. Distinct from
    /// `breaks`, which is a stream that opened and then died: this one never opens, and the caller
    /// has nothing to decide on.
    mute_stream: bool,
    /// The body chosen BY THE REQUEST, which is what a fan-out needs: `chunks` is one body for the
    /// whole fake, and a caller reading several containers' logs must be able to give each its own.
    /// Takes precedence over `chunks` when set.
    per_request: Option<StreamBody>,
    pinged: Arc<Mutex<Vec<HttpRequest>>>,
}

impl FakeHttp {
    /// The engine answers a ping the way a real one does — `200` with a body of `OK`, which is the
    /// pair `isApiRunning` requires.
    pub fn serving() -> Self {
        Self::scripted(|_| Ok(answered(200, "OK")))
    }

    /// Nothing is listening — the shape a stale forward socket or an engine that never started
    /// produces, and the one the false-ready defect used to report as `ready`.
    pub fn silent() -> Self {
        Self::scripted(|request| {
            Err(HttpError::Unreachable {
                endpoint: request.endpoint.clone(),
                reason: "connection refused".to_string(),
            })
        })
    }

    /// It answers, but not with success — an engine that is up and unhappy.
    pub fn answering(status: u16) -> Self {
        Self::scripted(move |_| Ok(answered(status, "")))
    }

    /// An engine that answers ordinary requests and NEVER answers a stream — no head, no error, no
    /// end. Apple's `container` behind socktainer 1.2.0, measured: `/events` is a routed path there
    /// (a bogus one answers 404) that writes nothing at all, held for 25 seconds through a real
    /// container event, while `/_ping` answers 200 throughout.
    pub fn silent_stream() -> Self {
        let mut fake = Self::scripted(|_| Ok(answered(200, "OK")));
        fake.mute_stream = true;
        fake
    }

    pub fn scripted(
        answer: impl Fn(&HttpRequest) -> Result<HttpResponse, HttpError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            answer: Box::new(answer),
            mute_stream: false,
            chunks: Vec::new(),
            breaks: false,
            per_request: None,
            pinged: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// A streamed body that delivers these pieces and then ends.
    pub fn delivering(self, chunks: &[&str]) -> Self {
        self.delivering_bytes(&chunks.iter().map(|it| it.as_bytes()).collect::<Vec<_>>())
    }

    /// The same, for a body that is not text — see [`FakeHttp::chunks`].
    pub fn delivering_bytes(mut self, chunks: &[&[u8]]) -> Self {
        self.chunks = chunks.iter().map(|it| it.to_vec()).collect();
        self
    }

    /// A streamed body chosen by the request — one body per member, for a fan-out.
    pub fn delivering_per_request(
        mut self,
        body: impl Fn(&HttpRequest) -> Vec<Vec<u8>> + Send + Sync + 'static,
    ) -> Self {
        self.per_request = Some(Box::new(body));
        self
    }

    /// The same, but the connection dies instead of ending — a tunnel dropped mid-log.
    pub fn breaking(mut self) -> Self {
        self.breaks = true;
        self
    }

    /// A handle on the record, taken BEFORE the fake is moved into the machine — the same seam
    /// [`FakeCommand::log`] exists for.
    pub fn log(&self) -> Arc<Mutex<Vec<HttpRequest>>> {
        Arc::clone(&self.pinged)
    }
}

impl Default for FakeHttp {
    /// Serving, so a fixture that says nothing about the engine's API gets one that is up — the same
    /// default the suite had when the address was all that was checked.
    fn default() -> Self {
        Self::serving()
    }
}

/// A response with nothing said about its head beyond the status — what most fixtures mean by "the
/// engine answered".
pub fn answered(status: u16, body: &str) -> HttpResponse {
    HttpResponse {
        status,
        status_text: String::new(),
        headers: Vec::new(),
        body: body.to_string(),
    }
}

#[async_trait]
impl Http for FakeHttp {
    async fn request(&self, request: &HttpRequest) -> Result<HttpResponse, HttpError> {
        self.pinged.lock().expect("pinged").push(request.clone());
        (self.answer)(request)
    }

    async fn stream(&self, request: &HttpRequest) -> Result<HttpStreamOpen, HttpError> {
        self.pinged.lock().expect("pinged").push(request.clone());
        if self.mute_stream {
            // Never resolves. The caller's own bound is the only thing that can end this, which is
            // the property under test.
            std::future::pending::<()>().await;
        }
        let head = (self.answer)(request)?;
        Ok(HttpStreamOpen {
            status: head.status,
            status_text: head.status_text,
            headers: head.headers,
            body: Box::new(ScriptedBody {
                chunks: match &self.per_request {
                    Some(body) => body(request).into_iter().collect(),
                    None => self.chunks.iter().cloned().collect(),
                },
                breaks: self.breaks,
                endpoint: request.endpoint.clone(),
            }),
        })
    }
}

/// A streamed body that hands back what it was given, then ends or dies.
///
/// Public because the server's stream registry is tested against one directly: what it has to prove is
/// what it does with the three answers a body can give, and going through a whole connection to
/// produce them would be testing the machine again.
pub struct ScriptedBody {
    chunks: std::collections::VecDeque<Vec<u8>>,
    breaks: bool,
    endpoint: cdc_runtime::capabilities::http::Endpoint,
}

impl ScriptedBody {
    /// A body that delivers these pieces and then ends cleanly.
    pub fn delivering(chunks: &[&str]) -> Self {
        Self::delivering_bytes(&chunks.iter().map(|it| it.as_bytes()).collect::<Vec<_>>())
    }

    /// The same, for a body that is not text.
    ///
    /// A container log is the case: its frame header ends in a big-endian length, so a payload of 128
    /// bytes puts `0x80` on the wire. An all-ASCII fixture cannot tell a byte-faithful carrier from one
    /// that decodes, which makes every assertion about the encoding a tautology.
    pub fn delivering_bytes(chunks: &[&[u8]]) -> Self {
        Self {
            chunks: chunks.iter().map(|it| it.to_vec()).collect(),
            breaks: false,
            endpoint: cdc_runtime::capabilities::http::Endpoint::UnixSocket(
                "/run/podman.sock".to_string(),
            ),
        }
    }

    /// The same, but the connection dies where the end would have been.
    pub fn breaking(mut self) -> Self {
        self.breaks = true;
        self
    }
}

#[async_trait]
impl HttpStream for ScriptedBody {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, HttpError> {
        if let Some(chunk) = self.chunks.pop_front() {
            return Ok(Some(chunk));
        }
        if self.breaks {
            return Err(HttpError::Unreachable {
                endpoint: self.endpoint.clone(),
                reason: "the tunnel went away mid-stream".to_string(),
            });
        }
        Ok(None)
    }
}
