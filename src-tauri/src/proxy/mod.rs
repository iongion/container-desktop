// The engine-API proxy — the Rust side of ICommand.ProxyRequest. It replaces BOTH the Node socket dial
// (the JS proxy-request builders) AND the
// webview↔native boundary. The Tauri-side JS binding
// (src/platform/tauri/exec/proxy-request.ts) re-synthesizes the
// EXACT shapes the unchanged `createApplicationApiDriver` (container-client/Api.clients.ts) consumes:
//   - buffered ok      → { data, status, statusText, headers }
//   - buffered failure → { __proxyError: true, status, statusText, data, headers, message }   (never thrown)
//   - stream           → { data: EmitterStream, status, statusText: "", headers }              (data/end/error)
//
// Cross-platform (unix socket on Linux/macOS, named pipe on Windows) is a hard requirement. reqwest forces
// requests over a LOCAL transport natively — ClientBuilder::unix_socket / ::windows_named_pipe — so one
// client API covers both platforms; only that one builder call is #[cfg]-gated. No hand-rolled HTTP.
//
// The connectivity-test command lives in connectivity.rs; the pure header/body/remap helpers in http.rs.

pub mod connectivity;
mod http;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::async_runtime::{self, JoinHandle};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::bridge::BridgeState;

// Buffered request default (mirrors createNodeJSApiDriver's 3000ms). Streams are untimed; only the OPEN
// (headers arriving) is bounded (mirrors the attachTimeout in runtimes/host-client.ts).
const DEFAULT_TIMEOUT_MS: u64 = 3000;
const STREAM_OPEN_TIMEOUT_MS: u64 = 15000;

// Input (deserialized from the JS binding; unknown fields ignored so a fuller payload is tolerated)

#[derive(Deserialize)]
pub struct ProxyRequestPayload {
    req: ProxyReq,
    connection: ProxyConnection,
    // Present for an SSH/WSL remote: the bridge Rust must bring up (and dial the LOCAL end of) before proxying.
    // Absent (None) for a direct local dial, where the socket comes from connection.settings.api.connection.
    #[serde(default)]
    bridge: Option<crate::bridge::BridgeSpec>,
}

#[derive(Deserialize, Default)]
struct ProxyReq {
    method: Option<String>,
    url: Option<String>,
    #[serde(rename = "baseURL")]
    base_url: Option<String>,
    params: Option<Value>,
    data: Option<Value>,
    // Already stringified by the JS binding's plainHeaders, so no Value→string coercion is needed here.
    headers: Option<HashMap<String, String>>,
    #[serde(rename = "responseType")]
    response_type: Option<String>,
    timeout: Option<u64>,
}

#[derive(Deserialize, Default)]
struct ProxyConnection {
    #[serde(default)]
    settings: ProxySettings,
}
#[derive(Deserialize, Default)]
struct ProxySettings {
    #[serde(default)]
    api: ProxyApi,
}
#[derive(Deserialize, Default)]
struct ProxyApi {
    #[serde(default)]
    connection: ProxyApiConnection,
}
#[derive(Deserialize, Default)]
struct ProxyApiConnection {
    uri: Option<String>,
    relay: Option<String>,
}

// Output

#[derive(Serialize)]
pub struct ProxyResponse {
    stream: bool,
    ok: bool,
    status: u16,
    #[serde(rename = "statusText")]
    status_text: String,
    headers: HashMap<String, String>,
    data: Value,
    message: Option<String>,
}

#[derive(Serialize)]
pub struct ProxyStreamHandle {
    stream: bool,
    #[serde(rename = "streamId")]
    stream_id: String,
    status: u16,
    headers: HashMap<String, String>,
}

// Pushed over the Tauri Channel; shape mirrors commandProxyProtocol.CommandProxyStreamEvent
// ({ streamId, type: "data" | "end" | "error", payload? }). pub(crate) because it appears in the
// (crate-visible) proxy_request_stream command signature as Channel<StreamEvent>.
#[derive(Clone, Serialize)]
pub(crate) struct StreamEvent {
    #[serde(rename = "streamId")]
    stream_id: String,
    #[serde(rename = "type")]
    event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<Value>,
}
impl StreamEvent {
    fn data(stream_id: &str, text: String) -> Self {
        Self {
            stream_id: stream_id.into(),
            event_type: "data".into(),
            payload: Some(Value::String(text)),
        }
    }
    fn end(stream_id: &str) -> Self {
        Self {
            stream_id: stream_id.into(),
            event_type: "end".into(),
            payload: None,
        }
    }
    fn error(stream_id: &str, message: String) -> Self {
        Self {
            stream_id: stream_id.into(),
            event_type: "error".into(),
            payload: Some(serde_json::json!({ "message": message })),
        }
    }
    // A control event (end/error, and text-stream data) crosses the Channel as JSON. Binary data (logs) instead
    // goes as InvokeResponseBody::Raw — see proxy_request_stream.
    fn into_ipc(self) -> InvokeResponseBody {
        InvokeResponseBody::Json(serde_json::to_string(&self).unwrap_or_else(|_| "{}".to_string()))
    }
}

// State: one reqwest client per socket (pool reuse) + the live-stream registry (teardown/abort)

#[derive(Default)]
pub struct ProxyState {
    clients: Mutex<HashMap<String, reqwest::Client>>,
    streams: Mutex<HashMap<String, JoinHandle<()>>>,
    counter: AtomicU64,
}
impl ProxyState {
    // A client is bound to ONE local transport (reqwest forces every request over it), so cache per socket
    // path — the connection pool is then reused across requests (mirrors the keep-alive agent).
    fn client_for(&self, socket_path: &str) -> Result<reqwest::Client, String> {
        if let Some(client) = self.clients.lock().unwrap().get(socket_path) {
            return Ok(client.clone());
        }
        let builder = reqwest::Client::builder();
        #[cfg(unix)]
        let builder = builder.unix_socket(socket_path);
        #[cfg(windows)]
        // npipe stripped form is `//./pipe/name`; the Win32 pipe API wants `\\.\pipe\name`.
        let builder = builder.windows_named_pipe(socket_path.replace('/', "\\"));
        let client = builder.build().map_err(|e| e.to_string())?;
        self.clients
            .lock()
            .unwrap()
            .insert(socket_path.to_string(), client.clone());
        Ok(client)
    }

    fn next_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        format!("cps-{n}")
    }
    fn register(&self, id: String, handle: JoinHandle<()>) {
        self.streams.lock().unwrap().insert(id, handle);
    }
    fn remove_and_abort(&self, id: &str) {
        if let Some(handle) = self.streams.lock().unwrap().remove(id) {
            handle.abort();
        }
    }
}

// Commands

/// Buffered request (responseType != "stream"): send, read the whole body, return a serializable response.
/// Errors (transport/timeout/build) come back as ok:false with a message — never a thrown command, so the
/// binding can always shape a __proxyError envelope instead of rejecting.
#[tauri::command]
pub async fn proxy_request(
    payload: ProxyRequestPayload,
    state: State<'_, ProxyState>,
    bridges: State<'_, BridgeState>,
) -> Result<ProxyResponse, ()> {
    let result = async {
        let socket = resolve_target(&payload, &bridges).await?;
        do_buffered(payload, socket, &state).await
    }
    .await;
    Ok(match result {
        Ok(resp) => resp,
        Err(msg) => ProxyResponse {
            stream: false,
            ok: false,
            status: 0,
            status_text: String::new(),
            headers: HashMap::new(),
            data: Value::Null,
            message: Some(msg),
        },
    })
}

// The socket/pipe reqwest should dial: for an SSH/WSL remote, ensure the bridge is up and dial its LOCAL end;
// for a direct connection, the socket from connection.settings.api.connection (relay|uri).
async fn resolve_target(
    payload: &ProxyRequestPayload,
    bridges: &BridgeState,
) -> Result<String, String> {
    match &payload.bridge {
        Some(spec) => crate::bridge::ensure_bridge(spec, bridges).await,
        None => resolve_socket_path(&payload.connection),
    }
}

async fn do_buffered(
    payload: ProxyRequestPayload,
    socket: String,
    state: &ProxyState,
) -> Result<ProxyResponse, String> {
    let response_type = payload.req.response_type.clone().unwrap_or_default();
    let timeout_ms = payload.req.timeout.unwrap_or(DEFAULT_TIMEOUT_MS);
    let client = state.client_for(&socket)?;
    let mut builder = build_request(&client, &payload.req)?;
    if timeout_ms > 0 {
        builder = builder.timeout(Duration::from_millis(timeout_ms));
    }
    let response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let headers = http::collect_headers(response.headers());
    let body = response.bytes().await.map_err(|e| e.to_string())?;
    let ok = (200..300).contains(&status);
    Ok(ProxyResponse {
        stream: false,
        ok,
        status,
        status_text,
        headers,
        data: http::parse_body(&body, &response_type),
        message: if ok {
            None
        } else {
            Some(format!("Request failed with status code {status}"))
        },
    })
}

/// Streaming request (responseType == "stream", e.g. /events or logs?follow): send, return the handle once
/// headers arrive, then pump body chunks over the Channel as { type: "data" } (utf8 string) until EOF
/// ({ type: "end" }) or transport error ({ type: "error" }). Only the OPEN is time-bounded; the stream is not.
#[tauri::command]
pub async fn proxy_request_stream(
    payload: ProxyRequestPayload,
    channel: Channel<InvokeResponseBody>,
    state: State<'_, ProxyState>,
    bridges: State<'_, BridgeState>,
) -> Result<ProxyStreamHandle, String> {
    let socket = resolve_target(&payload, &bridges).await?;
    let client = state.client_for(&socket)?;
    let builder = build_request(&client, &payload.req)?;
    // Container logs are BINARY (docker's multiplexed 8-byte frame headers + arbitrary payload bytes): pass the
    // chunks through as raw bytes (InvokeResponseBody::Raw) instead of a utf8-lossy String → JSON copy, which both
    // corrupts the framing and is slow for large output. /events (JSON text) stays on the string/JSON path.
    let binary = payload
        .req
        .url
        .as_deref()
        .unwrap_or_default()
        .contains("/logs");
    let response = tokio::time::timeout(
        Duration::from_millis(STREAM_OPEN_TIMEOUT_MS),
        builder.send(),
    )
    .await
    .map_err(|_| "stream open timeout".to_string())?
    .map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers = http::collect_headers(response.headers());
    let stream_id = state.next_id();

    let sid = stream_id.clone();
    let handle = async_runtime::spawn(async move {
        let mut stream = response.bytes_stream();
        loop {
            match stream.next().await {
                Some(Ok(chunk)) => {
                    let event = if binary {
                        InvokeResponseBody::Raw(chunk.to_vec())
                    } else {
                        StreamEvent::data(&sid, String::from_utf8_lossy(&chunk).into_owned())
                            .into_ipc()
                    };
                    let _ = channel.send(event);
                }
                Some(Err(err)) => {
                    let _ = channel.send(StreamEvent::error(&sid, err.to_string()).into_ipc());
                    return;
                }
                None => {
                    let _ = channel.send(StreamEvent::end(&sid).into_ipc());
                    return;
                }
            }
        }
    });
    state.register(stream_id.clone(), handle);
    Ok(ProxyStreamHandle {
        stream: true,
        stream_id,
        status,
        headers,
    })
}

/// Teardown from the JS emitter's destroy()/close() (or window close): abort the chunk pump and drop it.
#[tauri::command]
pub fn proxy_stream_destroy(stream_id: String, state: State<'_, ProxyState>) {
    state.remove_and_abort(&stream_id);
}

// Build the reqwest request: <baseURL>/<url> with query params, default headers overlaid by req.headers
// (request wins), JSON body from `data`. reqwest sets Host from the URL (default http://d) and does the
// query-string encoding via .query() (no hand-rolled encoder).
fn build_request(
    client: &reqwest::Client,
    req: &ProxyReq,
) -> Result<reqwest::RequestBuilder, String> {
    let method: reqwest::Method = req
        .method
        .clone()
        .unwrap_or_else(|| "GET".into())
        .to_uppercase()
        .parse()
        .map_err(|_| "invalid method".to_string())?;
    let base_url = req.base_url.clone().unwrap_or_else(|| "http://d".into());
    let mut url = format!(
        "{}{}",
        base_url.trim_end_matches('/'),
        req.url.clone().unwrap_or_default()
    );
    // Append the query via serde_urlencoded (what reqwest's own .query() uses). Params are a flat object of
    // scalars (Docker filters arrive pre-stringified); empty / non-object params add nothing.
    if let Some(params) = &req.params {
        if params.as_object().is_some_and(|object| !object.is_empty()) {
            if let Ok(query) = serde_urlencoded::to_string(params) {
                if !query.is_empty() {
                    url.push('?');
                    url.push_str(&query);
                }
            }
        }
    }

    let mut builder = client.request(method, url);
    if let Some(data) = &req.data {
        if !data.is_null() {
            builder = builder.body(serde_json::to_vec(data).map_err(|e| e.to_string())?);
        }
    }
    builder = builder.headers(http::build_headers(req.headers.as_ref()));
    Ok(builder)
}

// Resolve the local socket/pipe path from connection.settings.api.connection.{relay|uri} (relay wins, as in
// proxy-request.ts; empty for LOCAL). Strips the unix:// / npipe:// scheme, then applies the Flatpak remap.
fn resolve_socket_path(connection: &ProxyConnection) -> Result<String, String> {
    let relay = connection
        .settings
        .api
        .connection
        .relay
        .clone()
        .unwrap_or_default();
    let uri = connection
        .settings
        .api
        .connection
        .uri
        .clone()
        .unwrap_or_default();
    let raw = if !relay.is_empty() { relay } else { uri };
    let stripped = raw.replace("npipe://", "").replace("unix://", "");
    if stripped.is_empty() {
        return Err("no socket path (connection.settings.api.connection.uri is empty)".into());
    }
    Ok(http::flatpak_remap(stripped))
}
