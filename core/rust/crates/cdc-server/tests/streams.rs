//! The forwarded streams a server holds open (`src/streams.rs`).
//!
//! What has to be pinned is the LIFECYCLE, because every one of its ends is a leak or a corruption: a
//! body that keeps producing after the client asked it to stop, a client that goes away holding an
//! engine connection, a terminal frame that arrives twice, and an error that carries a socket path off
//! the machine.
//!
//! The bodies are `cdc-runtime`'s scripted fake, reached with `#[path]` rather than copied — one fake
//! set, parameterized, is this workspace's rule.

#[path = "../../cdc-runtime/tests/fakes/mod.rs"]
mod fakes;

use cdc_runtime::domain::types::command_proxy_protocol::StreamEventType;
use cdc_server::protocol::{Event, Push};
use cdc_server::server::ClientId;
use cdc_server::streams::ForwardedStreams;
use serde_json::Value;

use crate::fakes::ScriptedBody;

/// The frame's type and payload, which is all any of these cases is about.
fn frame(push: Push) -> (StreamEventType, Option<Value>) {
    let Event::Stream { stream } = push.event else {
        panic!("a stream registry publishes stream frames and nothing else");
    };
    (stream.type_, stream.payload)
}

/// More frames than any fixture here produces, and the bound a drain gives up at.
///
/// **Not tidiness — it is what stops a test from taking the machine down.** A mutant that removes a
/// loop's exit makes a body yield forever, and an unbounded `while let` then allocates until the
/// kernel OOM-kills the cgroup, which under `cargo mutants` is the run's own scope and every sibling
/// job in it. An infrastructure outcome, never a semantic failure — and the only honest place to
/// address it is the test's own organization.
const MOST_FRAMES: usize = 64;

/// Read a stream to its end, bounded.
async fn drain(streams: &ForwardedStreams, id: &str) -> Vec<(StreamEventType, Option<Value>)> {
    let mut seen = Vec::new();
    while let Some(push) = streams.next_frame(id).await {
        assert!(
            seen.len() <= MOST_FRAMES,
            "the stream never ended: {seen:?}"
        );
        seen.push(frame(push));
    }
    seen
}

#[tokio::test]
async fn an_opened_stream_is_named_the_way_the_original_names_one() {
    // `cps-<n>` is `commandProxyBroker.ts:openStream`'s spelling. A client may log it, so an id it has
    // seen before has to mean the same thing.
    let streams = ForwardedStreams::default();

    let first = streams.open(
        &ClientId::from("a"),
        Box::new(ScriptedBody::delivering(&[])),
    );
    let second = streams.open(
        &ClientId::from("a"),
        Box::new(ScriptedBody::delivering(&[])),
    );

    assert_eq!(first, "cps-1");
    assert_eq!(second, "cps-2", "and every one is its own");
    assert_eq!(streams.len(), 2);
    assert!(
        !streams.is_empty(),
        "asserted in both directions, or `is_empty` is a predicate that distinguishes nothing"
    );
}

/// A chunk as the wire carries it, so a case states the bytes and not the encoding.
fn carried(text: &str) -> Value {
    Value::Array(text.bytes().map(|byte| byte.into()).collect())
}

#[tokio::test]
async fn a_body_arrives_as_data_frames_and_ends_exactly_once() {
    // The `end` is what tells a client to stop reassembling. A second one would tear down a stream id
    // that may already have been reused.
    //
    // The payload is an ARRAY OF BYTES rather than a string, and that is load-bearing: a container log
    // frame's header is binary, so a string payload would have to decode it and could not. See
    // `streams::carried`.
    let streams = ForwardedStreams::default();
    let id = streams.open(
        &ClientId::from("a"),
        Box::new(ScriptedBody::delivering(&["first", "second"])),
    );

    let seen = drain(&streams, &id).await;

    assert_eq!(
        seen,
        vec![
            (StreamEventType::Data, Some(carried("first"))),
            (StreamEventType::Data, Some(carried("second"))),
            (StreamEventType::End, None),
        ]
    );
    assert!(
        streams.is_empty(),
        "a stream that ended is not one the server is still holding"
    );
}

#[tokio::test]
async fn a_log_frame_reaches_the_client_with_its_binary_header_intact() {
    // The case the ASCII fixtures above cannot distinguish. Every byte they carry is under `0x80`, so
    // an encoder that masked the high bit would satisfy all six of them — measured rather than
    // assumed, by making `carried` mask `& 0x7f` and watching this be the ONLY failure. A real
    // multiplexed header is what tells them apart: `01 00 00 00` then a big-endian length, here 200,
    // whose `0xc8` is not a valid UTF-8 byte. Verified against podman 5.7.0, which answers exactly
    // this shape for `/containers/<id>/logs`.
    let mut frame_bytes = vec![1_u8, 0, 0, 0, 0, 0, 0, 200];
    frame_bytes.extend(std::iter::repeat_n(b'A', 200));
    let streams = ForwardedStreams::default();
    let id = streams.open(
        &ClientId::from("a"),
        Box::new(ScriptedBody::delivering_bytes(&[&frame_bytes])),
    );

    let seen = drain(&streams, &id).await;

    let Some((StreamEventType::Data, Some(payload))) = seen.first() else {
        panic!("the frame arrives as one data event: {seen:?}");
    };
    let arrived: Vec<u8> = payload
        .as_array()
        .expect("carried as its bytes, never as text")
        .iter()
        .map(|byte| u8::try_from(byte.as_u64().expect("a byte value")).expect("a byte value"))
        .collect();
    assert_eq!(
        arrived, frame_bytes,
        "the header's length byte must survive, or no client can find the next frame"
    );
}

#[tokio::test]
async fn a_stream_that_dies_reports_a_code_and_never_the_error_it_would_render() {
    // `HttpError` renders its ENDPOINT, which is a socket path, and the design keeps paths out of
    // anything that leaves the process — the same rule that makes the server drop a `SettingsError`'s
    // reason. The code is the fact a client can act on.
    let streams = ForwardedStreams::default();
    let id = streams.open(
        &ClientId::from("a"),
        Box::new(ScriptedBody::delivering(&["a line"]).breaking()),
    );

    streams.next_frame(&id).await.expect("the line arrived");
    let (type_, payload) = frame(streams.next_frame(&id).await.expect("then it died"));

    assert_eq!(type_, StreamEventType::Error);
    assert_eq!(
        payload,
        Some(serde_json::json!({ "code": "API_UNREACHABLE" })),
        "a code, not a sentence, and no socket path anywhere in it"
    );
    assert!(streams.is_empty(), "and it is no longer held");
    assert!(
        streams.next_frame(&id).await.is_none(),
        "an error is terminal: nothing follows it"
    );
}

#[tokio::test]
async fn a_stream_a_client_destroyed_says_nothing_further() {
    // `COMMAND_PROXY.streamDestroy`. The client has said it wants nothing more, so it is not then told
    // that the thing it stopped has stopped.
    let streams = ForwardedStreams::default();
    let id = streams.open(
        &ClientId::from("a"),
        Box::new(ScriptedBody::delivering(&["a", "b"])),
    );

    streams.next_frame(&id).await.expect("the first chunk");
    assert!(streams.destroy(&id), "it was open");

    assert!(streams.next_frame(&id).await.is_none());
    assert!(
        !streams.destroy(&id),
        "and destroying it twice is not a second thing happening"
    );
}

#[tokio::test]
async fn a_client_that_goes_away_takes_only_its_own_streams() {
    // `disposeForSender`. A closed log view must not leak an engine connection — and must not take
    // another client's log with it, which is the asymmetry that makes a server worth running.
    let streams = ForwardedStreams::default();
    let leaving = ClientId::from("leaving");
    let staying = ClientId::from("staying");
    let theirs = streams.open(&leaving, Box::new(ScriptedBody::delivering(&["x"])));
    let ours = streams.open(&staying, Box::new(ScriptedBody::delivering(&["y"])));

    let reaped = streams.disconnect(&leaving);

    assert_eq!(reaped, 1);
    assert!(!streams.is_open(&theirs));
    assert!(streams.is_open(&ours), "another client's log is not theirs");
    assert_eq!(
        streams.disconnect(&leaving),
        0,
        "and a client with nothing open reaps nothing"
    );
}

#[tokio::test]
async fn a_stream_nobody_opened_produces_nothing() {
    // A client may name a stream the server has already ended. Answering a frame for it would be
    // inventing one.
    let streams = ForwardedStreams::default();

    assert!(streams.next_frame("cps-99").await.is_none());
    assert!(!streams.is_open("cps-99"));
}
