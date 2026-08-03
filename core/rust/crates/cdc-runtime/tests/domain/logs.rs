//! Reading a container log body back, answering to `src/domain/logs.rs`.
//!
//! **Every fixture here is BYTES, and the reason is measured.** A frame header's last four bytes are a
//! big-endian length, so a 172-byte line puts `0xac` on the wire — an all-ASCII fixture cannot see a
//! single rule in this file.

use cdc_runtime::domain::logs::{ContainerLogDecoder, decode_container_log_payload, to_log_bytes};
use serde_json::json;

/// One multiplexed frame: stream number, three zeroes, a big-endian length, then the payload.
fn framed(stream: u8, payload: &[u8]) -> Vec<u8> {
    let mut bytes = vec![stream, 0, 0, 0];
    bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

/// Bytes as the server's `streams::carried` puts them on the wire.
fn carried(bytes: &[u8]) -> serde_json::Value {
    serde_json::Value::Array(bytes.iter().map(|byte| (*byte).into()).collect())
}

#[test]
fn an_array_of_byte_values_is_what_the_carrier_sends_and_what_this_reads() {
    assert_eq!(
        to_log_bytes(&carried(&[0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xac])),
        vec![0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xac],
        "the length byte of a 172-byte line is 0xac, and it survives"
    );
    assert_eq!(
        to_log_bytes(&json!({ "data": [1, 2, 3] })),
        vec![1, 2, 3],
        "a node Buffer serialises as an object with a `data` array, and the original reads that too"
    );
    assert_eq!(to_log_bytes(&serde_json::Value::Null), Vec::<u8>::new());
}

#[test]
fn a_string_payload_is_truncated_per_code_unit_and_never_encoded_as_utf8() {
    // `charCodeAt(i) & 0xff`. U+00AC is one byte here and TWO in UTF-8, so a port that encoded
    // instead of truncating would put `0xc2 0xac` on a frame that claimed one byte.
    assert_eq!(to_log_bytes(&json!("\u{00ac}")), vec![0xac]);
    assert_eq!(
        to_log_bytes(&json!("ok")),
        vec![b'o', b'k'],
        "and ASCII is the same either way, which is why an ASCII fixture proves nothing here"
    );
}

#[test]
fn a_payload_that_is_neither_bytes_nor_a_string_is_still_read_as_something() {
    // The last-resort arm. No producer of this protocol reaches it — the carrier sends byte arrays — and
    // a reader that answered nothing for it would turn a peer's mistake into a silently empty log.
    assert_eq!(to_log_bytes(&json!(12)), b"12".to_vec());
    assert_eq!(to_log_bytes(&json!(true)), b"true".to_vec());
    assert_eq!(
        to_log_bytes(&json!({ "unexpected": "shape" })),
        br#"{"unexpected":"shape"}"#.to_vec(),
        "its JSON, where the original spells an object `[object Object]` — of the two readings only one \
         leaves a person something to look at"
    );
    assert_eq!(
        decode_container_log_payload(&json!(12)),
        "12",
        "and it decodes as the text it stands for rather than as a frame"
    );
}

#[test]
fn an_unframed_body_is_text_and_a_framed_one_is_demultiplexed() {
    assert_eq!(
        decode_container_log_payload(&carried(b"plain output\n")),
        "plain output\n",
        "nothing that looks like a header means nothing to demultiplex"
    );
    let mut body = framed(1, b"out\n");
    body.extend_from_slice(&framed(2, b"err\n"));
    assert_eq!(
        decode_container_log_payload(&carried(&body)),
        "out\nerr\n",
        "stdout and stderr are interleaved in arrival order, not separated"
    );
}

#[test]
fn a_frame_claiming_more_than_arrived_stops_the_scan_and_the_tail_is_kept() {
    let mut body = framed(1, b"whole\n");
    // A header promising sixteen bytes with four behind it: the original breaks out and appends the
    // remainder verbatim rather than reading past the end.
    body.extend_from_slice(&[1, 0, 0, 0, 0, 0, 0, 16]);
    body.extend_from_slice(b"cut!");
    let read = decode_container_log_payload(&carried(&body));
    assert!(read.starts_with("whole\n"), "{read:?}");
    assert!(
        read.contains("cut!"),
        "the unreadable tail travels rather than being dropped: {read:?}"
    );
}

#[test]
fn a_length_that_would_be_negative_in_the_original_is_refused_here_too() {
    // The original computes the length with a SIGNED 32-bit shift and rejects a negative one, so a
    // frame claiming 2 GiB or more is not a frame. Read as unsigned it would be a 2 GiB allocation.
    let mut body = vec![1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff];
    body.extend_from_slice(b"tail");
    assert_eq!(
        decode_container_log_payload(&carried(&body)),
        String::from_utf8_lossy(&body),
        "no frame was found, so the whole thing is text"
    );
}

#[test]
fn the_incremental_decoder_holds_a_partial_frame_back_and_releases_it_on_the_next_chunk() {
    let whole = framed(1, b"split across two chunks\n");
    let (head, tail) = whole.split_at(12);
    let mut decoder = ContainerLogDecoder::default();

    assert_eq!(
        decoder.push(&carried(head)),
        "",
        "half a frame is nothing to show yet, and showing its first bytes would corrupt the line"
    );
    assert!(!decoder.is_empty(), "it is held rather than discarded");
    assert_eq!(decoder.push(&carried(tail)), "split across two chunks\n");
    assert!(decoder.is_empty(), "and nothing is left over");
}

#[test]
fn the_incremental_decoder_flushes_an_unframed_chunk_whole() {
    let mut decoder = ContainerLogDecoder::default();
    assert_eq!(
        decoder.push(&carried(b"no framing here")),
        "no framing here"
    );
    assert!(
        decoder.is_empty(),
        "an unframed body has no partial frame to keep, so holding any of it would stall the view"
    );
    assert_eq!(
        decoder.push(&serde_json::Value::Null),
        "",
        "and an empty chunk is not an end-of-body"
    );
}
