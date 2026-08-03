//! `commandProxyProtocol.ts` — forwarding the engine's HTTP through the process that owns the tunnel.
//!
//! The original's reason for existing is the server's reason too, one layer out: a SINGLE engine
//! connection — one SSH tunnel, one WSL relay, one socket — must live in exactly one place, so
//! whoever holds it forwards HTTP on everyone else's behalf. In the desktop app that was renderer → host.
//! Here it is client → server, over the same shapes.
//!
//! **`pickSerializableRequest`, `pickConnection`, `shapeBufferedResponse` and `plainHeaders` are NOT
//! ported, and that is a decision rather than an omission.** All four exist to turn an *axios* config
//! into something serializable and back — they are the CALLER's side of this protocol, in the one
//! language that has an axios. A Rust or Go client builds [`CommandProxyRequestPayload`] directly and
//! never has the shape those functions strip down.
//!
//! `req` and `connection` stay free-form maps for the same reason the settings document does: `req`
//! is a subset of somebody else's request config, and typing it here would silently drop the key the
//! next axios version adds.

use serde_json::{Map, Value};

/// What a client sends to have one engine request forwarded.
///
/// The connection rides along whole so the server can route by `connection.id` — several
/// connections' forwarded HTTP are served at once, which is the entire point of the server owning
/// them.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
pub struct CommandProxyRequestPayload {
    /// The connection to route through. Absent falls back to the caller's default, exactly as the
    /// original's `?? primary` does — a core with no primary connection answers a refusal instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<Map<String, Value>>,
    /// A serializable subset of the request config: method, url, baseURL, params, data, headers,
    /// responseType, timeout.
    pub req: Map<String, Value>,
}

/// A forwarded response that fitted in one message.
///
/// **A non-2xx is carried rather than thrown**, with the engine's own status and body, so a client
/// can rebuild the error its HTTP library would have produced and its status checks behave exactly
/// as they would for a local request. That is the original's rule and it is load-bearing: an
/// adapter that branches on 404 must still see 404.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct CommandProxyResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(
        rename = "statusText",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub status_text: Option<String>,
    /// Always `false`. The literal that tells this apart from a stream handle on the wire.
    pub stream: bool,
}

/// A forwarded response that is a STREAM — container logs, events, attach. The body does not come
/// back here; it arrives as [`CommandProxyStreamEvent`]s keyed by this handle's id, which the
/// client reassembles.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct CommandProxyStreamHandle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// Always `true`.
    pub stream: bool,
    #[serde(rename = "streamId")]
    pub stream_id: String,
}

/// Either kind of forwarded reply.
///
/// Untagged, and discriminated by the `stream` literal the two structs carry — which is how the
/// original discriminates it, so a client written against the TypeScript reads this without knowing
/// it changed language.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum CommandProxyResult {
    Buffered(CommandProxyResponse),
    Stream(CommandProxyStreamHandle),
}

/// One chunk of a forwarded stream.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct CommandProxyStreamEvent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(rename = "streamId")]
    pub stream_id: String,
    #[serde(rename = "type")]
    pub type_: StreamEventType,
}

wire_enum! {
    /// What a stream chunk IS. `end` and `error` are both terminal — a client tears its reassembly
    /// down on either, and the server sends no further event for that id.
    StreamEventType {
        Data = "data",
        End = "end",
        Error = "error",
    }
}

/// Tear a forwarded stream down. A client that goes away without sending one is torn down by the
/// server anyway — a leaked stream holds an engine connection open.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct CommandProxyStreamDestroyRequest {
    #[serde(rename = "streamId")]
    pub stream_id: String,
}
