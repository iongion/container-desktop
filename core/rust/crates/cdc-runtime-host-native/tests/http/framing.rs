//! What the body IS, under the HTTP framing that carries it (`logs.ts`).
//!
//! An engine multiplexes a container's stdout and stderr into 8-byte-headed frames, and the header is
//! binary: a stream byte, three zeros, then a big-endian length. That is a second framing INSIDE the
//! chunked framing the tests beside this one pin, and the capability carries it without knowing it —
//! which is exactly why it has to survive byte for byte.

use std::path::Path;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// One multiplexed frame: `[stream, 0, 0, 0, len_be32]` then `len` bytes of payload.
fn log_frame(stream: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = vec![stream, 0, 0, 0];
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

/// Serve one connection and write RAW BYTES.
///
/// `serve_parts` takes `&str`, which cannot express a frame header: the length field is arbitrary
/// binary and a `str` is UTF-8 by construction.
fn serve_raw(socket: &Path, body: Vec<u8>) {
    let listener = tokio::net::UnixListener::bind(socket).expect("bind the test socket");
    tokio::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        let mut buffer = vec![0_u8; 1024];
        let _ = stream.read(&mut buffer).await;
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await;
        let _ = stream.write_all(&body).await;
        let _ = stream.flush().await;
    });
}

/// Everything the stream delivers, undecoded.
///
/// `super::drain` answers text, which is right for every other test in this target and is exactly what
/// this one must not do: decoding is the corruption being pinned.
async fn drain_raw(open: &mut cdc_runtime::capabilities::http::HttpStreamOpen) -> Vec<u8> {
    let mut arrived = Vec::new();
    while let Some(chunk) =
        tokio::time::timeout(std::time::Duration::from_secs(2), open.body.next_chunk())
            .await
            .expect("the stream neither delivered nor ended")
            .expect("a healthy stream")
    {
        arrived.extend_from_slice(&chunk);
    }
    arrived
}

#[tokio::test]
async fn a_multiplexed_log_frame_reaches_the_caller_byte_for_byte() {
    // A payload of 128 bytes makes the length field `00 00 00 80`, and `0x80` is not a valid UTF-8
    // start byte. Anything that decodes this body as text replaces it with U+FFFD — three bytes where
    // there was one — so the frame is not merely mangled, it is unrecoverable: a decoder downstream
    // cannot re-derive the length it was told, and every following frame is lost with it.
    let payload = vec![b'a'; 128];
    let frame = log_frame(1, &payload);

    let directory = super::short_tempdir();
    let socket = super::socket_in(&directory);
    serve_raw(&socket, frame.clone());

    let mut open = super::opened(&socket).await;
    let arrived = drain_raw(&mut open).await;

    assert_eq!(
        arrived,
        frame,
        "the frame did not survive: sent {} bytes, got {} back",
        frame.len(),
        arrived.len()
    );
}
