//! The forwarded streams this process holds open — `commandProxyBroker.ts`'s `streams` map.
//!
//! A container log, an `/events` follow and an attach are bodies that arrive over time, and they
//! cannot cross a request/response boundary whole. The original opens the stream in the process that
//! owns the connection and pushes its chunks to the window that asked; this does the same, one layer
//! out, with the chunks becoming [`Event::Stream`] frames.
//!
//! **Keyed by the CLIENT as well as by the stream, because a stream holds an engine connection open.**
//! `disposeForSender` exists in the original for exactly one reason: a window that closes while a log
//! view is open would otherwise leak a live engine stream per view. A client going
//! away still never tears a CONNECTION down — that is the server's whole point — but the streams it
//! asked for are its own.
//!
//! **Pumping takes `&self`, and that is not a style choice.** A stream is idle most of its life, so a
//! pump that took anything of the server's would hold it for as long as a log had nothing to say. The
//! registry is locked only to look a handle up; the wait happens on the handle.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use cdc_runtime::capabilities::http::HttpStream;
use cdc_runtime::domain::types::command_proxy_protocol::{
    CommandProxyStreamEvent, StreamEventType,
};
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;

use crate::protocol::{Event, Push};
use crate::server::ClientId;

/// The original's `cps-<n>` (`commandProxyBroker.ts:openStream`). Kept to the letter: a client may log
/// it, and an id it has seen before must mean the same thing.
const STREAM_ID_PREFIX: &str = "cps-";

/// One open stream and the client it belongs to.
struct Open {
    client: ClientId,
    /// Behind its own lock so the registry can be released before the wait. `Arc` because the pump
    /// holds it across an await that the registry must not be held across.
    body: Arc<tokio::sync::Mutex<Box<dyn HttpStream>>>,
}

#[derive(Default)]
struct State {
    counter: u64,
    open: BTreeMap<String, Open>,
}

/// Every forwarded stream this server has open.
#[derive(Default)]
pub struct ForwardedStreams {
    state: Mutex<State>,
}

impl ForwardedStreams {
    /// Take ownership of a stream and name it.
    pub fn open(&self, client: &ClientId, body: Box<dyn HttpStream>) -> String {
        let mut state = self.state.lock().expect("streams");
        state.counter += 1;
        let id = format!("{STREAM_ID_PREFIX}{}", state.counter);
        state.open.insert(
            id.clone(),
            Open {
                client: client.clone(),
                body: Arc::new(tokio::sync::Mutex::new(body)),
            },
        );
        id
    }

    /// Whether the server still holds it.
    pub fn is_open(&self, stream_id: &str) -> bool {
        self.state
            .lock()
            .expect("streams")
            .open
            .contains_key(stream_id)
    }

    pub fn len(&self) -> usize {
        self.state.lock().expect("streams").open.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Tear one down. Answers whether it was there, which is what tells a terminal frame apart from a
    /// second one.
    ///
    /// Dropping the handle is what closes the engine connection — the capability's own contract — so
    /// there is nothing else to call.
    pub fn destroy(&self, stream_id: &str) -> bool {
        self.state
            .lock()
            .expect("streams")
            .open
            .remove(stream_id)
            .is_some()
    }

    /// Reap everything a client that has gone away was holding — `disposeForSender`.
    ///
    /// Answers how many, because a client that disconnects holding streams is worth counting: it is
    /// the difference between an orderly close and a window that died mid-log.
    pub fn disconnect(&self, client: &ClientId) -> usize {
        let mut state = self.state.lock().expect("streams");
        let before = state.open.len();
        state.open.retain(|_, open| &open.client != client);
        before - state.open.len()
    }

    /// Wait for the next frame of one stream.
    ///
    /// `None` means there is nothing more to send for that id — it was never open, it was destroyed
    /// while this was waiting, or it has already delivered its terminal frame. A client that asked for
    /// a stream to stop is not told that it stopped.
    pub async fn next_frame(&self, stream_id: &str) -> Option<Push> {
        let body = {
            let state = self.state.lock().expect("streams");
            Arc::clone(&state.open.get(stream_id)?.body)
        };
        let chunk = body.lock().await.next_chunk().await;
        match chunk {
            // Destroyed while this was waiting: the handle is gone from the registry and the client
            // has already said it wants nothing more.
            Ok(Some(data)) => self
                .is_open(stream_id)
                .then(|| frame(stream_id, StreamEventType::Data, Some(carried(&data)))),
            Ok(None) => self
                .destroy(stream_id)
                .then(|| frame(stream_id, StreamEventType::End, None)),
            // **A code, never the error's own sentence.** `HttpError` renders its ENDPOINT, which is a
            // socket path, and the design keeps paths out of anything that leaves the process — the same
            // rule that makes the server drop a `SettingsError`'s reason. The code is the fact a client
            // can act on and it is the one `forward` refuses with.
            Err(_) => self.destroy(stream_id).then(|| {
                frame(
                    stream_id,
                    StreamEventType::Error,
                    Some(serde_json::json!({ "code": DiagnosticCode::ApiUnreachable })),
                )
            }),
        }
    }
}

/// A chunk as the wire carries it: its byte values, in order.
///
/// **Not a string, and that is the whole point.** A container log is multiplexed into frames whose
/// header ends in a big-endian length, so a 128-byte payload puts `0x80` on the wire — encoding that
/// as text replaces it with U+FFFD and the framing can no longer be read. An array of byte values is
/// what a node `Buffer` becomes in JSON, so the original's `toLogBytes` decodes this unchanged
/// (`logs.ts`, the `Array.isArray` arm) and no client has to learn anything new.
fn carried(data: &[u8]) -> serde_json::Value {
    serde_json::Value::Array(data.iter().map(|byte| (*byte).into()).collect())
}

fn frame(stream_id: &str, type_: StreamEventType, payload: Option<serde_json::Value>) -> Push {
    Push::new(Event::Stream {
        stream: Box::new(CommandProxyStreamEvent {
            payload,
            stream_id: stream_id.to_string(),
            type_,
        }),
    })
}
