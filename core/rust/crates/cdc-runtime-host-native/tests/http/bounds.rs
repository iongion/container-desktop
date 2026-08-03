//! What a whole-response read will hold — [`collect_body`], and the head bound above it.
//!
//! One rule in two places: this client ACCUMULATES, and an accumulator with no bound is how a process
//! is made to allocate the machine. Neither is reachable through a real socket in the shape that
//! matters, because a `SocketBody` always ends — so the body half is driven with a stream that answers
//! whatever it is told to, and the head half with a listener that sends bytes and never a blank line.
//!
//! **Every fake here is FINITE, and the listener always holds its connection open.** A stream that
//! really never ended would HANG this suite rather than fail it — the loop it feeds awaits nothing, so
//! no deadline above it can fire — and that is the trap `drain`'s doc names one file over: what has to
//! fail in seconds is a bound that has been removed.

use std::path::Path;
use std::time::Duration;

use async_trait::async_trait;
use cdc_runtime::capabilities::http::{Endpoint, Http, HttpError, HttpRequest, HttpStream};
use cdc_runtime_host_native::http::{MAX_HEAD_BYTES, TokioHttp, collect_body};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// A body that answers `piece` a fixed number of times and then ends.
///
/// The count is what keeps this suite honest: the case being pinned is a body that does not stop, and
/// a fake that really did not stop would take the worker with it. Four pieces past a bound proves the
/// same rule as four million.
struct Feed {
    piece: &'static str,
    left: usize,
}

#[async_trait]
impl HttpStream for Feed {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, HttpError> {
        if self.left == 0 {
            return Ok(None);
        }
        self.left -= 1;
        Ok(Some(self.piece.as_bytes().to_vec()))
    }
}

/// An address nothing is listening on: a body has already been opened by the time [`collect_body`]
/// runs, so the endpoint here is only what the refusal names.
fn nowhere() -> Endpoint {
    Endpoint::UnixSocket("/nowhere/e.sock".to_string())
}

#[tokio::test]
async fn a_body_past_the_bound_is_refused_rather_than_accumulated() {
    // The failure this exists for is not a large reply — it is a FEED sent to the call that reads one
    // whole answer. `/events` never ends, and what the deadline above the loop bounds is TIME: three
    // seconds of a local socket is gigabytes.
    let mut feed = Feed {
        piece: "xyzzy",
        left: 4,
    };

    let error = collect_body(&nowhere(), &mut feed, 15)
        .await
        .expect_err("twenty bytes into a fifteen-byte bound");

    assert!(matches!(error, HttpError::TooLarge { .. }), "{error:?}");
}

#[tokio::test]
async fn a_body_that_exactly_fills_the_bound_is_delivered_whole() {
    // The other direction, and it is the whole of what `>` means here. Without it the bound may as
    // well be one byte tighter and nothing in this suite would say so.
    let mut feed = Feed {
        piece: "xyzzy",
        left: 3,
    };

    let collected = collect_body(&nowhere(), &mut feed, 15)
        .await
        .expect("fifteen bytes into a fifteen-byte bound");

    assert_eq!(collected, "xyzzyxyzzyxyzzy");
}

#[tokio::test]
async fn a_chunk_with_nothing_in_it_is_refused_rather_than_asked_again() {
    // Neither of the two answers the contract has: not data, and not the end. A reader that took it
    // would come straight back for the next piece of a body with nothing left to give — and it would
    // do that without awaiting anything, which is a spin rather than a wait. Nothing above it can
    // interrupt a spin, so this is the only place the case can be answered at all.
    let mut feed = Feed { piece: "", left: 2 };

    let error = collect_body(&nowhere(), &mut feed, 15)
        .await
        .expect_err("an empty piece is not a piece");

    assert!(matches!(error, HttpError::Malformed { .. }), "{error:?}");
}

#[test]
fn the_head_bound_is_the_number_the_oracle_already_enforces() {
    // **Written out rather than derived, because the NUMBER is the agreement.** Node's parser refuses
    // a head past `--max-http-header-size`, whose default is 16 KiB, and axios goes through it — so a
    // head this port refuses is one the original refuses too.
    //
    // It is here because every other test in this file builds its fixture FROM the constant and would
    // follow it wherever it moved: `16 * 1024` mutated to `16 + 1024` left a client refusing heads at
    // 1040 bytes with all four of them still passing, and a scoped mutation run is what said so.
    assert_eq!(MAX_HEAD_BYTES, 16 * 1024);
}

/// Bind, send each part with a pause between, and then HOLD the connection open.
///
/// **Holding is the measurement.** A listener that closes hands `read_head` an end-of-stream, which
/// `status_line` refuses for a reason of its own — so a test against a closing peer passes whether or
/// not the head is bounded at all. What has to be shown is the bound firing while the peer is still
/// perfectly willing to send more.
fn serve_and_hold(socket: &Path, parts: Vec<String>) {
    let listener = tokio::net::UnixListener::bind(socket).expect("bind the test socket");
    tokio::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        let mut buffer = vec![0_u8; 1024];
        let _ = stream.read(&mut buffer).await;
        for part in parts {
            let _ = stream.write_all(part.as_bytes()).await;
            let _ = stream.flush().await;
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
}

#[tokio::test]
async fn a_head_with_no_blank_line_in_it_is_refused_while_the_peer_is_still_sending() {
    // A peer that sends and sends and never sends the blank line. `stream` carries no deadline by
    // design, so without this bound the buffer grows for as long as the peer keeps writing — and the
    // only reason `request` survives it today is a clock that says nothing about memory.
    let directory = super::short_tempdir();
    let socket = super::socket_in(&directory);
    serve_and_hold(&socket, vec!["x".repeat(MAX_HEAD_BYTES + 1)]);

    let error = TokioHttp
        .request(&HttpRequest::ping(super::unix(&socket)))
        .await
        .expect_err("a head that never ends is not a head");

    let HttpError::Malformed { reason, .. } = &error else {
        panic!("the bound must answer, not the deadline above it: {error:?}");
    };
    assert!(reason.contains("no blank line"), "{reason:?}");
}

#[tokio::test]
async fn a_head_that_exactly_fills_the_bound_is_still_a_head() {
    // `>` and not `>=`, and only a head AT the bound tells them apart. The pause is what makes the
    // measurement land: however the kernel chunks the first write, the client drains it to exactly the
    // bound and asks again — so the check is reached at exactly [`MAX_HEAD_BYTES`], with no blank line
    // in the buffer yet, which is the one arrangement where the two spellings differ.
    //
    // Opened rather than requested, because this peer HOLDS: a whole-response read would go on waiting
    // for the end of a body that is never closed, and what is being asked here is only whether the
    // head was accepted.
    let directory = super::short_tempdir();
    let socket = super::socket_in(&directory);
    let opening = "HTTP/1.1 200 OK\r\nX-Pad: ";
    let head = format!("{opening}{}", "x".repeat(MAX_HEAD_BYTES - opening.len()));
    assert_eq!(head.len(), MAX_HEAD_BYTES, "the head is AT the bound");
    serve_and_hold(&socket, vec![head, "\r\n\r\nOK".to_string()]);

    let open = super::opened(&socket).await;

    assert_eq!(open.status, 200);
    assert_eq!(
        open.headers.first().map(|(name, _)| name.as_str()),
        Some("X-Pad"),
        "the whole head was read, not a prefix of it"
    );
}
