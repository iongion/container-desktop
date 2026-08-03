//! `commandProxyClient.ts` — the CLIENT half of the forwarding protocol.
//!
//! The server half is [`crate::domain::machine::proxy`]. Pure translation, no I/O: what carries a
//! payload is the [`Forwarder`] port.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Map, Value};

use crate::capabilities::http::{
    Endpoint, Http, HttpError, HttpHeader, HttpRequest, HttpResponse, HttpStream, HttpStreamOpen,
};
use crate::domain::logs::to_log_bytes;
use crate::domain::types::command_proxy_protocol::{
    CommandProxyRequestPayload, CommandProxyResponse, CommandProxyStreamEvent,
    CommandProxyStreamHandle, StreamEventType,
};
use crate::domain::types::diagnostic::ReportedDiagnostic;

/// `responseType: "stream"` — the key `machine::proxy` branches on.
const STREAM_RESPONSE_TYPE: &str = "stream";

/// What a forwarded request produced.
pub enum Forwarded {
    Buffered(CommandProxyResponse),
    Stream(ForwardedStream),
}

/// A forwarded stream, and the channel its chunks will arrive on.
///
/// The channel is registered by the forwarder in the same step that reads the handle out of the reply:
/// a caller subscribing afterwards would race the first chunk.
pub struct ForwardedStream {
    pub handle: CommandProxyStreamHandle,
    pub chunks: tokio::sync::mpsc::Receiver<CommandProxyStreamEvent>,
}

#[derive(Debug, thiserror::Error)]
pub enum ForwardError {
    /// The link to whoever owns the transport is gone. Nothing was sent, or nothing will come back.
    #[error("the forwarder is not connected")]
    Disconnected,
    /// It answered, and refused — an code, rendered by whoever shows it.
    #[error("the request was refused: {}", diagnostic.code)]
    Refused { diagnostic: Box<ReportedDiagnostic> },
}

/// Carrying one payload to whoever owns the connection's transport.
#[async_trait]
pub trait Forwarder: Send + Sync {
    async fn forward(
        &self,
        payload: &CommandProxyRequestPayload,
    ) -> Result<Forwarded, ForwardError>;

    /// Tear a forwarded stream down. Fire and forget, because [`HttpStream`]'s contract is that
    /// dropping it closes the stream and `Drop` cannot await — which is why the original's
    /// `COMMAND_PROXY.streamDestroy` is an `ipcRenderer.send` rather than an `invoke`.
    fn destroy(&self, stream_id: &str);
}

/// The engine API of a connection this process does not own.
///
/// One per client, not per connection: which connection a request is routed through is
/// [`Endpoint::Connection`], carried on the request like every other address.
pub struct ForwardedHttp {
    forwarder: Arc<dyn Forwarder>,
}

impl ForwardedHttp {
    pub fn new(forwarder: Arc<dyn Forwarder>) -> Self {
        Self { forwarder }
    }
}

#[async_trait]
impl Http for ForwardedHttp {
    async fn request(&self, request: &HttpRequest) -> Result<HttpResponse, HttpError> {
        let payload = payload(request, false)?;
        match self
            .forwarder
            .forward(&payload)
            .await
            .map_err(|error| refused(error, &request.endpoint))?
        {
            Forwarded::Buffered(response) => Ok(buffered(response)),
            // Asked for a whole answer and handed a feed. The stream is destroyed rather than dropped
            // silently, because the far side is holding an engine connection for it.
            Forwarded::Stream(stream) => {
                self.forwarder.destroy(&stream.handle.stream_id);
                Err(HttpError::Malformed {
                    endpoint: request.endpoint.clone(),
                    reason: "a whole-response read was answered with a stream handle".to_string(),
                })
            }
        }
    }

    async fn stream(&self, request: &HttpRequest) -> Result<HttpStreamOpen, HttpError> {
        let payload = payload(request, true)?;
        match self
            .forwarder
            .forward(&payload)
            .await
            .map_err(|error| refused(error, &request.endpoint))?
        {
            Forwarded::Stream(stream) => Ok(opened(
                stream,
                Arc::clone(&self.forwarder),
                request.endpoint.clone(),
            )),
            // A non-2xx never takes this arm — `machine::proxy` opens the stream whatever the status
            // and `EngineApi::open` is what refuses one. This is a far side that ignored
            // `responseType`, which is a protocol disagreement rather than an engine's answer.
            Forwarded::Buffered(response) => Err(HttpError::Malformed {
                endpoint: request.endpoint.clone(),
                reason: format!(
                    "a stream was answered with a whole response: {}",
                    response.status.unwrap_or_default()
                ),
            }),
        }
    }
}

/// The request, as the payload that carries it.
///
/// **Only the id travels in `connection`.** `pickConnection` also copies `host` and the api settings,
/// and this port's server reads none of them.
fn payload(
    request: &HttpRequest,
    streaming: bool,
) -> Result<CommandProxyRequestPayload, HttpError> {
    let Endpoint::Connection(connection_id) = &request.endpoint else {
        return Err(HttpError::Unsupported(request.endpoint.clone()));
    };
    if connection_id.is_empty() {
        return Err(HttpError::Unsupported(request.endpoint.clone()));
    }
    let mut req = Map::new();
    req.insert("method".to_string(), request.method.clone().into());
    // `url`, never `params`: the query is already in the path and `machine::proxy` refuses a `params`
    // key outright.
    req.insert("url".to_string(), request.path.clone().into());
    if !request.headers.is_empty() {
        req.insert(
            "headers".to_string(),
            Value::Object(headers(&request.headers)),
        );
    }
    if let Some(body) = &request.body {
        // A string travels as itself, which is what the far side puts on the wire — the body is already
        // serialized, and sending it as parsed JSON would re-serialize somebody else's bytes.
        req.insert("data".to_string(), body.clone().into());
    }
    if let Some(timeout) = request.timeout {
        req.insert("timeout".to_string(), (timeout.as_millis() as u64).into());
    }
    if streaming {
        req.insert(
            "responseType".to_string(),
            STREAM_RESPONSE_TYPE.to_string().into(),
        );
    }
    let mut connection = Map::new();
    connection.insert("id".to_string(), connection_id.clone().into());
    Ok(CommandProxyRequestPayload {
        connection: Some(connection),
        req,
    })
}

/// Ordered pairs as the object the protocol carries.
///
/// **Collapsing is forced by the shape** — `req.headers` is a JSON object on both sides, because the
/// original's `plainHeaders` produces one. Nothing an adapter sends can repeat a field:
/// `EngineApi::headers_for` already merges case-insensitively.
fn headers(headers: &[HttpHeader]) -> Map<String, Value> {
    headers
        .iter()
        .map(|(name, value)| (name.clone(), Value::String(value.clone())))
        .collect()
}

/// A whole forwarded answer, as the response it stands for.
///
/// **A non-2xx is carried, never refused** — the same rule the far side keeps, and load-bearing for the
/// same reason: an adapter that branches on 404 must still see 404.
fn buffered(response: CommandProxyResponse) -> HttpResponse {
    HttpResponse {
        // A reply with no status is a far side this port did not write — `machine::proxy::buffered`
        // always fills it. `0` is never `ok()`, so the body still reaches whoever can read it.
        status: response.status.unwrap_or_default(),
        status_text: response.status_text.unwrap_or_default(),
        headers: response
            .headers
            .map(|headers| headers.iter().filter_map(header_pair).collect())
            .unwrap_or_default(),
        body: body(response.data),
    }
}

/// The body as bytes-worth-of-text again.
///
/// **The one lossy corner of the round trip, and it is the protocol's rather than this port's.** The far
/// side parses a JSON body and carries the value, so a body that WAS a bare JSON string comes back
/// without its quotes — indistinguishable here from a plain-text body like `/_ping`'s `OK`. Every engine
/// route an adapter reads answers an object or an array. Pinned by
/// `a_bare_json_string_body_is_indistinguishable_from_plain_text`.
fn body(data: Option<Value>) -> String {
    match data {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text,
        Some(value) => value.to_string(),
    }
}

/// A header as it travels back: the far side writes strings, and a number or a boolean is coerced the
/// way `plainHeaders` coerces one.
fn header_pair((name, value): (&String, &Value)) -> Option<HttpHeader> {
    let value = match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        _ => return None,
    };
    Some((name.clone(), value))
}

/// A stream handle, as the open response it stands for.
///
/// **`status_text` is empty and that is the protocol**: [`CommandProxyStreamHandle`] has no such field,
/// and the original's `createForwardedStream` sends `""` for it.
fn opened(
    stream: ForwardedStream,
    forwarder: Arc<dyn Forwarder>,
    endpoint: Endpoint,
) -> HttpStreamOpen {
    let ForwardedStream { handle, chunks } = stream;
    HttpStreamOpen {
        status: handle.status.unwrap_or_default(),
        status_text: String::new(),
        headers: handle
            .headers
            .as_ref()
            .map(|headers| headers.iter().filter_map(header_pair).collect())
            .unwrap_or_default(),
        body: Box::new(ForwardedBody {
            stream_id: handle.stream_id,
            chunks,
            forwarder,
            endpoint,
            terminal: false,
        }),
    }
}

/// A forwarded body: the chunks the far side pushes, reassembled in order.
struct ForwardedBody {
    stream_id: String,
    chunks: tokio::sync::mpsc::Receiver<CommandProxyStreamEvent>,
    forwarder: Arc<dyn Forwarder>,
    /// The route this body came down, so a failure names the connection rather than the stream alone.
    endpoint: Endpoint,
    /// Whether a terminal frame has arrived. What tells a finished stream from a link that died.
    terminal: bool,
}

#[async_trait]
impl HttpStream for ForwardedBody {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, HttpError> {
        loop {
            let Some(event) = self.chunks.recv().await else {
                // The channel closed without a terminal frame: the session went away mid-body. A
                // truncated log reported as a complete one is the worst reading available.
                if self.terminal {
                    return Ok(None);
                }
                self.terminal = true;
                return Err(HttpError::Unreachable {
                    endpoint: self.endpoint.clone(),
                    reason: format!("the stream {} ended with its session", self.stream_id),
                });
            };
            match event.type_ {
                StreamEventType::Data => {
                    let bytes = to_log_bytes(event.payload.as_ref().unwrap_or(&Value::Null));
                    // The capability's contract: `Ok(Some)` carries at least one byte, so an empty
                    // payload is waited through rather than answered as an end-of-body.
                    if !bytes.is_empty() {
                        return Ok(Some(bytes));
                    }
                }
                StreamEventType::End => {
                    self.terminal = true;
                    return Ok(None);
                }
                StreamEventType::Error => {
                    self.terminal = true;
                    return Err(HttpError::Unreachable {
                        endpoint: self.endpoint.clone(),
                        reason: event
                            .payload
                            .map(|payload| payload.to_string())
                            .unwrap_or_default(),
                    });
                }
            }
        }
    }
}

impl Drop for ForwardedBody {
    /// **Only when it has not finished.** The far side destroys a stream itself on the terminal frame
    /// (`streams::next_frame`), so a destroy after `end` asks it to forget what it has already forgotten.
    fn drop(&mut self) {
        if !self.terminal {
            self.forwarder.destroy(&self.stream_id);
        }
    }
}

/// Why a forward failed, as the engine-reachability answer its caller asked for.
///
/// **Wider than the name, deliberately, and `machine::proxy::unreachable` makes the same call for the
/// same reason**: an adapter asked whether it could reach the engine, and "the server refused" and "the
/// socket refused" are one answer to that with one action. The `reason` carries which.
fn refused(error: ForwardError, endpoint: &Endpoint) -> HttpError {
    HttpError::Unreachable {
        endpoint: endpoint.clone(),
        reason: error.to_string(),
    }
}
