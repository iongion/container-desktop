//! The two reads that keep a LIVE connection live (, `engineDataService.ts`).
//!
//! A connection that reached `ready` has proved the engine answered ONCE. Everything after that is a
//! claim with nothing behind it until something asks again, and the original asks in two ways that do
//! different jobs: it holds the `/events` stream open, whose END is the trigger
//! (`connectEvents`/`onDropped`), and it then pings — three times, two seconds apart — before
//! believing it (`handleEventsDrop`/`pingUntilAvailable`). The trigger is instant and occasionally
//! wrong; the verdict is slow and never is. Both are ported, and this file is the machine's half.
//!
//! **The endpoint is the same one the probe and a forward use**, which is the rule
//! `availability.rs` already states about the probe: an engine watched at one address and dialled at
//! another is a liveness answer about something else.

use crate::fakes::{FakeCommand, FakeHttp};
use crate::harness::{Harness, engine_is_healthy, engine_socket_bound, linux, options, podman};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::capabilities::http::Endpoint;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;

/// A connection that has been through a connect, over whatever engine the test wants next.
///
/// Through a real attempt rather than hand-built settings, because what these two reads resolve is
/// what DETECTION resolved — the address in `connection.settings` is the user's guess and the one
/// they must not ask at.
async fn live(http: FakeHttp) -> Harness {
    let mut harness = Harness::with_http(
        options(podman(), false),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        http,
    );
    harness.connect(1_000).await;
    harness
}

#[tokio::test]
async fn the_events_stream_is_opened_on_the_address_the_readiness_probe_used() {
    let harness = live(FakeHttp::serving().delivering(&["{\"status\":\"start\"}\n"])).await;
    let probed = harness.pinged().last().expect("a readiness probe").clone();

    harness
        .machine
        .watch_events()
        .await
        .expect("the engine is up, so the stream opens");

    let asked = harness.pinged().last().expect("the events request").clone();
    // The WHOLE request, never its tail: a watch assembled against the wrong address reports a
    // healthy engine as gone, and it would do it from a line that reads perfectly.
    assert_eq!(asked.method, "GET");
    assert_eq!(asked.path, "/events");
    assert_eq!(asked.body, None);
    assert_eq!(
        asked.endpoint,
        Endpoint::UnixSocket("/run/podman.sock".to_string())
    );
    assert_eq!(
        asked.endpoint, probed.endpoint,
        "one resolver answers for the probe and the watch, or they are watching different engines"
    );
}

#[tokio::test]
async fn the_events_stream_is_never_given_a_read_timeout() {
    // **The rule this whole read exists under**, and the original states it in as many words
    // (`host-client.ts:getEventsStream`): `/events` is mostly idle, so a finite read timeout aborts
    // it seconds after it opens, the drop handler re-subscribes, and an events-FIRST design silently
    // becomes a reconnect POLL loop — the exact thing the owner did not choose. `HttpRequest::timeout`
    // says the same thing on the field, and this is the assertion that makes it true of this caller.
    let harness = live(FakeHttp::serving()).await;

    harness.machine.watch_events().await.expect("it opens");

    let asked = harness.pinged().last().expect("the events request").clone();
    assert_eq!(asked.timeout, None, "a stream is bounded by the reader");
}

#[tokio::test]
async fn the_events_stream_carries_the_headers_the_daemon_selects_on() {
    // `api.baseURL` picks the `Host` a daemon answers as, so a watch asking with a different one is
    // not asking about the same daemon. Same headers as the probe, from the same builder.
    let harness = live(FakeHttp::serving()).await;
    let probed = harness.pinged().last().expect("a readiness probe").clone();

    harness.machine.watch_events().await.expect("it opens");

    let asked = harness.pinged().last().expect("the events request").clone();
    assert_eq!(asked.headers, probed.headers);
    assert!(
        asked.headers.iter().any(|(name, _)| name == "Host"),
        "and the pair that matters is actually in there: {:?}",
        asked.headers
    );
}

#[tokio::test]
async fn the_body_delivers_what_the_engine_sent_and_then_ends() {
    // The bytes are DISCARDED by this port — there is no resource cache to refresh — so what is
    // asserted is the shape a watcher reads: chunks, then `None`, which is the end that means the
    // engine let go.
    let harness = live(FakeHttp::serving().delivering(&["one", "two"])).await;

    let mut open = harness.machine.watch_events().await.expect("it opens");

    assert_eq!(open.body.next_chunk().await.unwrap(), Some(b"one".to_vec()));
    assert_eq!(open.body.next_chunk().await.unwrap(), Some(b"two".to_vec()));
    assert_eq!(
        open.body.next_chunk().await.unwrap(),
        None,
        "and then the end, which is the trigger"
    );
}

#[tokio::test]
async fn watching_a_connection_that_resolved_no_address_refuses_rather_than_dialling_nothing() {
    // Same refusal a forward gets, from the same resolver. A watcher that swallowed this would sit
    // on a connection it was never watching and report it healthy forever.
    let mut harness = Harness::new(options(podman(), false), linux(None), |argv| match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
        [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => CommandExecutionResult::ok("{}"),
    });
    harness.connect(0).await;

    let refused = harness
        .machine
        .watch_events()
        .await
        .expect_err("no address");

    assert_eq!(refused.code, DiagnosticCode::ApiSocketUnresolved);
}

#[tokio::test]
async fn a_probe_says_the_engine_is_still_answering() {
    let harness = live(FakeHttp::serving()).await;

    assert!(harness.machine.probe().await.is_ok());
}

#[tokio::test]
async fn a_probe_says_so_when_the_engine_has_stopped_answering() {
    // The verdict half. `FakeHttp::silent` is a stale socket or an engine that went away — the shape
    // that used to be reported as `ready`. Detection still resolved the address, so this is a probe
    // that reaches a real endpoint and finds nothing on it, rather than one with nowhere to go.
    let harness = live(FakeHttp::silent()).await;

    let refused = harness
        .machine
        .probe()
        .await
        .expect_err("nothing is listening");

    assert_eq!(refused.code, DiagnosticCode::ApiUnreachable);
    assert!(
        !harness.machine.settings().api.connection.uri.is_empty(),
        "and it had an address to ask at, or this would be the other refusal"
    );
}
