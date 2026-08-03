//! `logs.ts` — reading a container log body back out of what a carrier delivered.
//!
//! The producer is the server's `streams::carried`

use serde_json::Value;

/// A frame header is three legal stream numbers, three zero bytes, then a big-endian length.
const HEADER: usize = 8;

/// `toLogBytes` — a payload as the bytes it stands for, whichever shape it arrived in.
pub fn to_log_bytes(value: &Value) -> Vec<u8> {
    match value {
        Value::Array(items) => items.iter().map(byte_of).collect(),
        Value::Object(map) => match map.get("data") {
            Some(Value::Array(items)) => items.iter().map(byte_of).collect(),
            _ => text_bytes(value),
        },
        // `charCodeAt(i) & 0xff`, which is a UTF-16 code unit and not a scalar value.
        Value::String(text) => text
            .encode_utf16()
            .map(|unit| (unit & 0xff) as u8)
            .collect(),
        Value::Null => Vec::new(),
        _ => text_bytes(value),
    }
}

/// `decodeContainerLogPayload` — the whole body as text, demultiplexed when it is framed.
pub fn decode_container_log_payload(value: &Value) -> String {
    decode_container_log_bytes(&to_log_bytes(value))
}

/// The same, for a caller that already HAS the bytes.
///
/// `EngineApi::drain` answers `Vec<u8>`, so a caller reading a log off the socket has nothing to convert
/// — and converting bytes into a `Value` to hand them back would be lossy in exactly the place this
/// module exists to protect.
pub fn decode_container_log_bytes(bytes: &[u8]) -> String {
    let mut offset = 0;
    let mut payloads: Vec<&[u8]> = Vec::new();
    while let Some(end) = frame_end(bytes, offset) {
        payloads.push(&bytes[offset + HEADER..end]);
        offset = end;
    }
    if payloads.is_empty() {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    // Unconditionally, because an exhausted body slices to nothing and joins to nothing: a `<` guard
    // here is a comparison with two readings that produce the same string, which is a mutant nothing
    // can assert against.
    payloads.push(&bytes[offset..]);
    joined(&payloads)
}

/// `createContainerLogDecoder` — the same, fed a chunk at a time, holding a partial frame back.
#[derive(Debug, Default)]
pub struct ContainerLogDecoder {
    pending: Vec<u8>,
}

impl ContainerLogDecoder {
    /// Whatever is now readable. An unframed body is flushed whole; a framed one keeps its tail.
    pub fn push(&mut self, value: &Value) -> String {
        self.pending.extend_from_slice(&to_log_bytes(value));
        if self.pending.is_empty() {
            return String::new();
        }
        if !is_header(&self.pending, 0) {
            return String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned();
        }
        let mut offset = 0;
        let mut payloads: Vec<&[u8]> = Vec::new();
        while let Some(end) = frame_end(&self.pending, offset) {
            payloads.push(&self.pending[offset + HEADER..end]);
            offset = end;
        }
        let text = joined(&payloads);
        self.pending.drain(..offset);
        text
    }

    /// Whether a partial frame is still being held.
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

/// Where the frame at `offset` ends, or `None` when there is no whole frame there.
fn frame_end(bytes: &[u8], offset: usize) -> Option<usize> {
    if !is_header(bytes, offset) {
        return None;
    }
    // Signed, because the original's `<<` is a signed 32-bit shift and it then rejects a negative
    // length: a frame claiming 2 GiB or more must be refused the same way here.
    let length = i32::from_be_bytes([
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
    ]);
    let length = usize::try_from(length).ok()?;
    let end = offset.checked_add(HEADER)?.checked_add(length)?;
    (end <= bytes.len()).then_some(end)
}

fn is_header(bytes: &[u8], offset: usize) -> bool {
    bytes.len() >= offset + HEADER
        && matches!(bytes[offset], 0..=2)
        && bytes[offset + 1..offset + 4] == [0, 0, 0]
}

/// Decoded per payload and joined, which is what the original does: a character split across two
/// frames is mangled in both trees.
fn joined(payloads: &[&[u8]]) -> String {
    payloads
        .iter()
        .map(|payload| String::from_utf8_lossy(payload))
        .collect()
}

fn byte_of(item: &Value) -> u8 {
    item.as_u64().unwrap_or_default() as u8
}

/// The last resort — a number, a boolean, or an object carrying no `data`.
///
/// The original's is `TextEncoder().encode(`${value}`)`, which spells an object `[object Object]`. This
/// answers its JSON instead: no producer of this protocol reaches the arm, and of the two readings only
/// one leaves a person something to look at.
fn text_bytes(value: &Value) -> Vec<u8> {
    value.to_string().into_bytes()
}
