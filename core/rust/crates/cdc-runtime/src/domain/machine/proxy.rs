//! Forwarding one client's engine HTTP through the connection that owns the transport.
//!
//! The counterpart of `commandProxyBroker.ts:handleRequest`, and it exists for the reason
//! gives: a single SSH tunnel, WSL relay or socket must live in exactly one place, so whoever holds it
//! serves everyone else's requests. In the desktop app that place was the privileged side; here it is the
//! connection machine, which is the only thing that knows what this connection resolved.
//!
//! **There is no branch on host type, and that is the whole of `getProxyRequestRoute` answered by a
//! capability instead.** The original picks `direct` / `wsl` / `ssh` per `ContainerEngineHost` because
//! its renderer reaches a guest socket through machinery the main process owns. Here `start_api` has
//! already opened whatever this connection needs (the forward is what makes the resolved
//! uri mean anything), so `api.connection.uri` is locally dialable for every transport — one address,
//! asked the same way the readiness probe asks it. `relay` is the IN-GUEST end and is never dialled
//! from here.
//!
//! **The phase is not consulted.** A forward against a connection that is down fails at the socket and
//! says so with the code it deserves — `API_SOCKET_UNRESOLVED` when nothing ever resolved an address,
//! `API_UNREACHABLE` when the address is there and nothing is serving. A separate "not ready" check
//! would be a second opinion about the same fact, free to disagree with the socket.

use std::time::Duration;

use super::ConnectionMachine;
use crate::capabilities::http::{Endpoint, HttpHeader, HttpRequest, HttpResponse, HttpStreamOpen};
use crate::domain::diagnostic::Diagnostic;
use crate::domain::sandbox::host_path;
use crate::domain::types::command_proxy_protocol::{
    CommandProxyRequestPayload, CommandProxyResponse,
};
use crate::domain::types::connection::{EngineConnectorApiSettings, EngineConnectorSettings};
use crate::domain::types::diagnostic::DiagnosticCode;
use crate::runtimes::dialects::shared::normalize_unix_socket_path;
use serde_json::{Map, Value};

/// The `responseType` that means the body arrives over time — `commandProxyBroker.ts:handleRequest`.
const STREAM_RESPONSE_TYPE: &str = "stream";

/// What a forwarded request produced, before the server names the stream.
///
/// The wire has [`CommandProxyResult`](crate::domain::types::command_proxy_protocol::CommandProxyResult)
/// for the same fork, but its streaming arm carries a `streamId` — and minting that id, like the
/// original's `cps-<n>` counter, belongs to whoever will be pushing the chunks. So the machine answers
/// the two SHAPES and the server names one of them.
#[derive(Debug)]
pub enum ForwardedResponse {
    Buffered(CommandProxyResponse),
    Stream(HttpStreamOpen),
}

impl ConnectionMachine {
    /// Forward one request to this connection's engine.
    ///
    /// The `connection` half of the payload is the SERVER's routing key and is already spent by the
    /// time this is called — a machine forwards for itself and for nothing else.
    pub async fn forward(
        &self,
        payload: &CommandProxyRequestPayload,
    ) -> Result<ForwardedResponse, Diagnostic> {
        let request = self.forwarded_request(payload)?;
        if streams(&payload.req) {
            return Ok(ForwardedResponse::Stream(
                self.http.stream(&request).await.map_err(unreachable)?,
            ));
        }
        let response = self.http.request(&request).await.map_err(unreachable)?;
        Ok(ForwardedResponse::Buffered(buffered(response)))
    }

    /// The payload's `req`, as a request this port can put on a socket.
    fn forwarded_request(
        &self,
        payload: &CommandProxyRequestPayload,
    ) -> Result<HttpRequest, Diagnostic> {
        let req = &payload.req;
        // A query string this core cannot build is refused rather than dropped. The original's `params`
        // is an AXIOS shape — arrays, nested objects and its own percent-encoding — and a client of
        // this protocol has no axios (`command_proxy_protocol` says so where the picker functions were
        // deliberately not ported). `HttpRequest::path` already carries the query, so the query belongs
        // in `url`; half-serializing `filters` here would send a request that looks right and asks
        // something else.
        if req.contains_key("params") {
            return Err(invalid("params"));
        }
        let Some(path) = text(req, "url").filter(|url| !url.is_empty()) else {
            return Err(invalid("url"));
        };
        Ok(HttpRequest {
            endpoint: endpoint(&self.settings, self.sandboxed())?,
            method: text(req, "method")
                .map(|method| method.to_ascii_uppercase())
                .unwrap_or_else(|| "GET".to_string()),
            path,
            headers: headers(&self.settings.api, req, &self.context.app_version),
            body: body(req),
            timeout: timeout(req),
        })
    }
}

/// Which LOCAL address this connection's engine is reached at.
///
/// The same two steps [`ConnectionMachine::probe_api`](super::ConnectionMachine) takes, and shared with
/// it on purpose: a forward that resolved the address differently from the readiness probe would report
/// an engine as up and then send its traffic somewhere else.
pub(super) fn endpoint(
    settings: &EngineConnectorSettings,
    sandboxed: bool,
) -> Result<Endpoint, Diagnostic> {
    // A resolved bridge OUTRANKS the address, and it has to: when one is present the engine's socket is
    // somewhere this machine cannot open — inside a distribution, inside a VM — and `uri` is at best the
    // address a relay WOULD serve. The original reaches the same engine by binding that address with a
    // relay process and pumping it into the command (`wsl-relay.ts`, `sshApiConnection`'s bridge); this
    // port has the `Http` capability speak straight down the command instead, which is the design's
    // `Stdio` address kind and removes the relay, the second address and the question of which of them
    // is authoritative. `getApiConnection` ranks it first for the same reason.
    let bridge = &settings.api.connection.dial_stdio_command;
    if !bridge.is_empty() {
        return Ok(Endpoint::Stdio(bridge.clone()));
    }
    // Re-spelled for a flatpak sandbox BEFORE anything is asked of it, so the address checked and the
    // address dialled stay the same string — `Api.clients.ts:getApiConfig` remaps at the same point,
    // and the whole reason this resolver is shared is that a probe and a request must not diverge.
    // `sandboxed` is already the conjunction of "this process is in a sandbox" and "this host's socket
    // is a host path"; see `HostProfile::sandbox_maps_socket`.
    let socket = host_path(
        &normalize_unix_socket_path(&settings.api.connection.uri),
        sandboxed,
    );
    // Empty means either nothing was ever resolved, or a scheme `normalize_unix_socket_path` does not
    // speak. The only thing that could turn the second into an address is a host read out of the base
    // URL and a network connection opened to it — reach this core has no caller for.
    if socket.is_empty() {
        return Err(Diagnostic::new(DiagnosticCode::ApiSocketUnresolved));
    }
    Ok(crate::runtimes::transports::shared::api_endpoint(&socket))
}

/// The headers every request to this connection's engine carries — `Api.clients.ts:getApiConfig`.
///
/// `Host` first, because it is the one the daemon SELECTS on: `api.baseURL` is `http://d` for Podman
/// and `http://localhost` for Docker and Apple, and the field's own doc says that is not cosmetic. The
/// two content headers are the oracle's defaults and are what makes a Docker or Podman write parse —
/// both require `Content-Type` on one.
///
/// **`User-Agent: Container Desktop <version>` names the APP and never this core's own version.**
/// The version this core holds is `user-settings.json`'s schema stamp, a different number, so the
/// one that belongs here arrives as data on [`super::ConnectionContext`] — beside `home` and `arch`,
/// which are host knowledge for the same reason. A host that never said sends no agent at all, on the
/// rule `Host` follows two lines below: a header that looks answered and names nothing is worse in an
/// engine's log than one that is absent.
pub fn api_headers(api: &EngineConnectorApiSettings, app_version: &str) -> Vec<HttpHeader> {
    let mut headers = Vec::new();
    let host = host_header(&api.base_url);
    if !host.is_empty() {
        headers.push(("Host".to_string(), host));
    }
    headers.push(("Accept".to_string(), "application/json".to_string()));
    headers.push(("Content-Type".to_string(), "application/json".to_string()));
    if !app_version.is_empty() {
        headers.push((
            "User-Agent".to_string(),
            format!("Container Desktop {app_version}"),
        ));
    }
    headers
}

/// The authority in a base URL — `http://d` is `d`, `http://localhost:2375` is `localhost:2375`.
///
/// **This produces a HEADER and never an address.** An earlier version of `api_endpoint` read the same
/// field to build `Endpoint::Tcp` and was removed in review: turning a settings string into a host and
/// port is outbound network reach nothing in this port asks for. A `Host:` line opens nothing.
fn host_header(base_url: &str) -> String {
    let authority = base_url
        .split_once("://")
        .map_or(base_url, |(_, rest)| rest);
    authority
        .split(['/', '?'])
        .next()
        .unwrap_or_default()
        .to_string()
}

/// The oracle's `deepMerge({}, config.headers, request.headers)`: the connection's defaults, then the
/// caller's, so a request that names its own `Content-Type` keeps it.
fn headers(
    api: &EngineConnectorApiSettings,
    req: &Map<String, Value>,
    app_version: &str,
) -> Vec<HttpHeader> {
    let mut headers = api_headers(api, app_version);
    let Some(asked) = req.get("headers").and_then(Value::as_object) else {
        return headers;
    };
    for (name, value) in asked {
        let Some(value) = header_value(value) else {
            continue;
        };
        match headers
            .iter_mut()
            .find(|(existing, _)| existing.eq_ignore_ascii_case(name))
        {
            Some(existing) => existing.1 = value,
            None => headers.push((name.clone(), value)),
        }
    }
    headers
}

/// `plainHeaders` — a string, a number or a boolean becomes text, and anything else is dropped.
///
/// The original strips them for IPC serializability; the reason they are dropped HERE is that a header
/// value is a string on the wire and an object has no honest spelling as one.
fn header_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

/// Whether the caller asked for the body to arrive over time.
fn streams(req: &Map<String, Value>) -> bool {
    text(req, "responseType").as_deref() == Some(STREAM_RESPONSE_TYPE)
}

/// `req.data`, as bytes to send. A string travels as itself; anything else is the JSON the engine APIs
/// expect, which is what axios does for an object body.
fn body(req: &Map<String, Value>) -> Option<String> {
    match req.get("data") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(text.clone()),
        Some(value) => Some(value.to_string()),
    }
}

/// `req.timeout`, in milliseconds. `0` is axios's "no timeout", which is a stream's and is expressed
/// here by leaving the request untimed.
fn timeout(req: &Map<String, Value>) -> Option<Duration> {
    let millis = req.get("timeout").and_then(Value::as_u64)?;
    (millis > 0).then(|| Duration::from_millis(millis))
}

fn text(req: &Map<String, Value>, key: &str) -> Option<String> {
    req.get(key).and_then(Value::as_str).map(str::to_string)
}

/// The engine answered — with anything at all.
///
/// **A non-2xx is CARRIED rather than refused**, which is the original's rule and is load-bearing: an
/// adapter that branches on 404 must still see 404, so the status, the reason phrase, the headers and
/// the engine's own body all travel back and the client rebuilds whatever error its HTTP library would
/// have raised.
///
/// **`message` is left absent, and it is the one field of the shape that is.** The original fills it
/// from the axios error's sentence; this core has no HTTP library to quote and the design keeps prose out
/// of what it sends. `status`, `statusText` and `data` carry the same facts, typed.
fn buffered(response: HttpResponse) -> CommandProxyResponse {
    let ok = response.ok();
    CommandProxyResponse {
        data: Some(data(&response.body)),
        headers: Some(
            response
                .headers
                .into_iter()
                .map(|(name, value)| (name, Value::String(value)))
                .collect(),
        ),
        message: None,
        ok,
        status: Some(response.status),
        status_text: Some(response.status_text),
        stream: false,
    }
}

/// The body as the client will read it: parsed when it is JSON, and the raw text when it is not.
///
/// `response.data` is already parsed in the original, because axios parses by content type. A client
/// that had to parse a string itself would have to know the content type this port dropped, so the
/// parse happens here — and a body that is not JSON (an engine's plain-text error, `/_ping`'s `OK`)
/// survives as a string rather than becoming a failure.
fn data(body: &str) -> Value {
    serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.to_string()))
}

/// The engine could not be reached at all — the one case the original throws for.
///
/// Shared with [`super::liveness`] rather than written twice: a watch that failed to attach and a
/// forward that failed to send are the same fact about the same address, and two spellings of it
/// would be two codes a client had to learn.
///
/// **One reading is wider than the name, and it is deliberate.** `HttpError::TooLarge` says the engine
/// answered perfectly well and the answer will not fit one response — so "could not be reached" is not
/// true of it. It arrives here anyway because the vocabulary is eighteen codes and a nineteenth for a
/// case whose fix is "ask for a stream instead" is a code every client would have to learn to say
/// nothing new. The `reason` parameter carries the engine's actual sentence, which is where a person
/// reads the difference.
pub(super) fn unreachable(error: crate::capabilities::http::HttpError) -> Diagnostic {
    Diagnostic::with_params(
        DiagnosticCode::ApiUnreachable,
        serde_json::json!({ "reason": error.to_string() }),
    )
}

/// A `req` this core cannot honour, naming the field rather than guessing at it.
fn invalid(field: &str) -> Diagnostic {
    Diagnostic::with_params(
        DiagnosticCode::ProxyRequestInvalid,
        serde_json::json!({ "field": field }),
    )
}
