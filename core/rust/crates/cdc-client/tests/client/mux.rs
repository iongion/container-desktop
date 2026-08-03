//! One task owning the socket, answering to `src/mux.rs`.
//!
//! **Against the real embedded server**, not a peer this file plays: what the mux is for is correlating
//! replies and routing stream chunks, and both are properties of frames a real session writes.

use std::sync::Arc;

use cdc_client::embedded;
use cdc_client::mux::{Answer, Mux};
use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::capabilities::fs::FsLocks;
use cdc_runtime::capabilities::http::{Endpoint, Http, HttpRequest};
use cdc_runtime::command_proxy::{ForwardError, ForwardedHttp, Forwarder};
use cdc_runtime::domain::types::command_proxy_protocol::CommandProxyRequestPayload;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::resource_sync_protocol::ConnectOrigin;
use cdc_server::listen::session::Shared;
use cdc_server::protocol::{Command, Event, Outbound, Reply};
use cdc_server::server::{MachineBuilder, Server};
use futures_util::SinkExt;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

use crate::fakes::Gate;
use crate::harness::{
    self, CONNECTION, engine_is_bound, gated_server, running_server, seeded, server,
    streaming_server,
};

/// A mux over a client of this process's own server.
///
/// Generic over the server, because the harness builds two: one that composes no machine and one that
/// brings a real connection up against a bound socket.
async fn attached<F, B, C>(
    server: Server<F, B, C>,
) -> (Arc<Mux>, cdc_client::mux::Frames, Arc<Shared<F, B, C>>)
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let shared = Shared::new(server, CancellationToken::new());
    let client = crate::bounded(embedded::attach(Arc::clone(&shared)))
        .await
        .expect("a server in this process is always reachable");
    let (mux, frames) = Mux::spawn(client);
    (Arc::new(mux), frames, shared)
}

/// The frame a client is handed on arrival, off the channel rather than off the socket.
async fn arrival(frames: &mut cdc_client::mux::Frames) -> Outbound {
    tokio::time::timeout(harness::PATIENCE, frames.recv())
        .await
        .expect("a client is handed the state as it attaches")
        .expect("the channel is live")
        .expect("and the frame is readable")
}

#[tokio::test]
async fn a_reply_reaches_the_caller_that_asked_and_a_push_reaches_the_loop() {
    let (mux, mut frames, _shared) = attached(server(seeded())).await;

    // The arrival snapshot is nobody's reply, so it goes to the loop.
    let handed = arrival(&mut frames).await;
    assert!(
        matches!(handed, Outbound::Pushed(push) if matches!(push.event, Event::Snapshot { .. })),
        "a push has no correlation id and cannot be anybody's answer"
    );

    let Answer::Replied(Reply::Connections { connections }) =
        crate::bounded(mux.ask(Command::ListConnections)).await
    else {
        panic!("the caller that asked is the one that is answered");
    };
    assert_eq!(
        connections.first().map(|it| it.id.as_str()),
        Some(CONNECTION),
        "and the answer is the document's"
    );
}

#[tokio::test]
async fn two_callers_asking_at_once_are_each_answered_their_own_reply() {
    let (mux, mut frames, _shared) = attached(server(seeded())).await;
    let _ = arrival(&mut frames).await;

    // **The whole reason a mux exists.** Both are in flight on one socket; a client that assumed the
    // next reply was its own would answer one of these with the other's.
    let (connections, snapshot) = tokio::join!(
        mux.ask(Command::ListConnections),
        mux.ask(Command::GetRuntimeSnapshot),
    );
    assert!(
        matches!(connections, Answer::Replied(Reply::Connections { .. })),
        "the first caller got the list it asked for"
    );
    assert!(
        matches!(snapshot, Answer::Replied(Reply::Snapshot { .. })),
        "and the second got the snapshot, not the list"
    );
}

#[tokio::test]
async fn a_refusal_is_told_apart_from_a_session_that_ended() {
    let (mux, mut frames, shared) = attached(server(seeded())).await;
    let _ = arrival(&mut frames).await;

    let refused = crate::bounded(mux.ask(Command::Connect {
        connection_id: "host.invented".to_string(),
        origin: ConnectOrigin::User,
    }))
    .await;
    assert!(
        matches!(refused, Answer::Refused(_)),
        "a connection nobody stored is a refusal with a code, which has something to fix"
    );

    shared.clients.cancel_all();
    // Whatever is in flight when a session ends is answered rather than left on a channel whose sender
    // was dropped — the two read the same to a caller and say different things about why.
    let gone = crate::bounded(async {
        loop {
            if let Answer::Gone = mux.ask(Command::ListConnections).await {
                return;
            }
        }
    })
    .await;
    let () = gone;
}

#[tokio::test]
async fn a_forwarded_request_reaches_the_engine_and_comes_back_as_a_response() {
    // A real engine socket, bound and answering: the round trip is client -> mux -> protocol ->
    // server -> machine -> socket and all the way back.
    let (mux, mut frames, _shared) = attached(running_server(engine_is_bound())).await;
    let _ = arrival(&mut frames).await;

    let http = ForwardedHttp::new(Arc::clone(&mux) as Arc<dyn Forwarder>);
    let response = crate::bounded(http.request(&HttpRequest {
        endpoint: Endpoint::Connection(CONNECTION.to_string()),
        method: "GET".to_string(),
        path: "/_ping".to_string(),
        headers: Vec::new(),
        body: None,
        timeout: None,
    }))
    .await
    .expect("the engine answered through two processes' worth of plumbing");

    assert!(
        response.ok(),
        "and the connection was brought up on the way, exactly as the broker awaits ensureConnected: \
         {response:?}"
    );
}

#[tokio::test]
async fn a_forwarded_stream_is_routed_to_the_body_that_opened_it_and_ended_by_its_terminal_frame() {
    // The whole streaming path: the server opens an engine stream, pumps its chunks into `Event::Stream`
    // pushes, and the mux routes each one to the body that is reassembling it — never to the loop.
    let (mux, mut frames, _shared) =
        attached(streaming_server(engine_is_bound(), &["one\n", "two\n"])).await;
    let _ = arrival(&mut frames).await;

    let http = ForwardedHttp::new(Arc::clone(&mux) as Arc<dyn Forwarder>);
    let mut open = crate::bounded(http.stream(&HttpRequest {
        endpoint: Endpoint::Connection(CONNECTION.to_string()),
        method: "GET".to_string(),
        path: "/containers/x/logs?follow=false".to_string(),
        headers: Vec::new(),
        body: None,
        timeout: None,
    }))
    .await
    .expect("the stream opened");

    let mut read = Vec::new();
    while let Some(chunk) = crate::bounded(open.body.next_chunk())
        .await
        .expect("a chunk or an end")
    {
        read.extend_from_slice(&chunk);
    }
    assert_eq!(
        String::from_utf8(read).expect("the body"),
        "one\ntwo\n",
        "every chunk, in order, byte for byte — through a channel the mux registered as it read the \
         handle out of the reply"
    );
}

#[tokio::test]
async fn a_reader_that_falls_a_whole_queue_behind_is_told_rather_than_left_waiting() {
    // Enough chunks to overrun the per-stream buffer with nothing reading them. The pump must not wait
    // here — it also reads every other stream and every reply — so the stream is torn down, and what
    // that must produce for the reader is an error and not a wait that never ends.
    let many: Vec<String> = (0..64).map(|index| format!("line {index}\n")).collect();
    let chunks: Vec<&str> = many.iter().map(String::as_str).collect();
    let (mux, mut frames, _shared) = attached(streaming_server(engine_is_bound(), &chunks)).await;
    let _ = arrival(&mut frames).await;

    let http = ForwardedHttp::new(Arc::clone(&mux) as Arc<dyn Forwarder>);
    let mut open = crate::bounded(http.stream(&HttpRequest {
        endpoint: Endpoint::Connection(CONNECTION.to_string()),
        method: "GET".to_string(),
        path: "/containers/x/logs?follow=true".to_string(),
        headers: Vec::new(),
        body: None,
        timeout: None,
    }))
    .await
    .expect("the stream opened");

    // Let the far side get well ahead of this reader before it reads anything at all.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // **What is asserted is that it ENDS**, which is the property: `crate::bounded` is a deadline, so a
    // reader left waiting on a sender nobody will ever write to again fails here rather than hanging.
    // Whether it ends with the overrun's error or with a clean `end` is the scheduler's business — both
    // are honest answers and asserting on which one would be asserting on a race.
    let mut ended = false;
    let mut chunks_read = 0;
    while !ended {
        match crate::bounded(open.body.next_chunk()).await {
            Ok(Some(_)) => chunks_read += 1,
            Ok(None) => ended = true,
            Err(_) => ended = true,
        }
    }
    assert!(
        chunks_read < 64,
        "a reader that read nothing for 200ms cannot have been handed every chunk: the buffer is {} \
         and the rest were dropped rather than the socket stalled",
        16
    );
}

#[tokio::test]
async fn a_stream_chunk_never_reaches_the_loop() {
    let (mux, mut frames, _shared) =
        attached(streaming_server(engine_is_bound(), &["only\n"])).await;
    let _ = arrival(&mut frames).await;

    let http = ForwardedHttp::new(Arc::clone(&mux) as Arc<dyn Forwarder>);
    let mut open = crate::bounded(http.stream(&HttpRequest {
        endpoint: Endpoint::Connection(CONNECTION.to_string()),
        method: "GET".to_string(),
        path: "/containers/x/logs".to_string(),
        headers: Vec::new(),
        body: None,
        timeout: None,
    }))
    .await
    .expect("the stream opened");
    while crate::bounded(open.body.next_chunk())
        .await
        .expect("a chunk or an end")
        .is_some()
    {}

    // A chunk is part of a body somebody is reassembling, so a loop that received one would have to
    // decide what to do with bytes it cannot place — and the terminal that renders these has no answer.
    while let Ok(Some(frame)) =
        tokio::time::timeout(std::time::Duration::from_millis(100), frames.recv()).await
    {
        assert!(
            !matches!(frame, Ok(Outbound::Pushed(ref push)) if matches!(push.event, Event::Stream { .. })),
            "a stream frame reached the loop: {frame:?}"
        );
    }
}

#[tokio::test]
async fn a_payload_naming_no_connection_is_refused_by_the_server_and_reported_here() {
    let (mux, mut frames, _shared) = attached(server(seeded())).await;
    let _ = arrival(&mut frames).await;

    let mut req = serde_json::Map::new();
    req.insert("url".to_string(), "/_ping".into());
    // `Forwarded` carries a live channel and has no `Debug`, so the failure is matched rather than
    // unwrapped — which is also the only reading that says what a success here would mean.
    let Err(refused) = crate::bounded(Forwarder::forward(
        &*mux,
        &CommandProxyRequestPayload {
            connection: None,
            req,
        },
    ))
    .await
    else {
        panic!("this core has no primary connection to fall back to");
    };

    assert!(
        refused.to_string().contains("PROXY_REQUEST_INVALID"),
        "the code the server refused with, carried rather than replaced: {refused}"
    );
}

#[tokio::test]
async fn a_destroy_nobody_is_waiting_on_is_still_issued() {
    let (mux, mut frames, _shared) = attached(server(seeded())).await;
    let _ = arrival(&mut frames).await;

    // `tell` is what a `Drop` can call, so it cannot await — but the frame still goes out, and the
    // reply it produces has no correlation anybody holds, so it reaches the loop.
    Forwarder::destroy(&*mux, "cps-404");

    let answered = crate::bounded(async {
        loop {
            if let Some(Ok(Outbound::Answer(response))) = frames.recv().await {
                return response;
            }
        }
    })
    .await;
    assert!(
        matches!(harness::replied(answered), Reply::Destroyed),
        "answered whether or not one was there: a client tearing down a stream the server already \
         ended is describing the state it wants"
    );
}

#[tokio::test]
async fn asking_after_the_pump_has_gone_is_answered_rather_than_written_into_a_closed_channel() {
    let (mux, mut frames, shared) = attached(server(seeded())).await;
    let _ = arrival(&mut frames).await;

    shared.clients.cancel_all();
    // The pump drops its frame sender as it exits, so a closed channel is the one observable that says
    // the task has actually gone. Asking before that races it and takes the pending path instead.
    crate::bounded(async { while frames.recv().await.is_some() {} }).await;

    assert!(
        matches!(
            crate::bounded(mux.ask(Command::ListConnections)).await,
            Answer::Gone
        ),
        "the command cannot even be written, and a caller must be told so rather than parked on a \
         reply that can never arrive"
    );
}

#[tokio::test]
async fn a_caller_waiting_on_a_connect_is_told_when_the_session_dies_under_it() {
    let gate = Gate::shut();
    let (mux, mut frames, shared) = attached(gated_server(engine_is_bound(), gate.clone())).await;
    let _ = arrival(&mut frames).await;

    let asking = tokio::spawn({
        let mux = Arc::clone(&mux);
        async move {
            mux.ask(Command::Connect {
                connection_id: CONNECTION.to_string(),
                origin: ConnectOrigin::User,
            })
            .await
        }
    });
    // Held inside `spawn_service`, which is where a real attempt spends its 51 seconds — so the connect
    // is issued, its id is in the pump's pending map, and nothing has answered it.
    crate::bounded(gate.reached()).await;

    shared.clients.cancel_all();

    let answered = crate::bounded(asking)
        .await
        .expect("the asking task finished");
    assert!(
        matches!(answered, Answer::Gone),
        "a reply that will never come is answered as the pump exits, rather than left on a oneshot \
         whose sender was merely dropped — which reads the same to a caller and says nothing about why"
    );
    gate.open();
}

#[tokio::test]
async fn a_forward_answered_with_a_reply_that_is_not_a_proxy_result_is_refused() {
    // A peer this test plays, because a real server never answers a `ProxyRequest` with anything else —
    // and what this pins is that the mux says so instead of treating the wrong shape as a success.
    let (client, mut peer) = crate::impersonated().await;
    let (mux, _frames) = Mux::spawn(client);

    let forwarding = tokio::spawn(async move {
        let mut req = serde_json::Map::new();
        req.insert("url".to_string(), "/_ping".into());
        Forwarder::forward(
            &mux,
            &CommandProxyRequestPayload {
                connection: None,
                req,
            },
        )
        .await
    });

    // Answered under its own id, or the mux would correctly ignore it as nobody's reply.
    let sent: serde_json::Value = serde_json::from_str(&crate::next_text(&mut peer).await)
        .expect("what a client writes is JSON");
    let id = sent["id"].as_str().expect("a correlation id");
    peer.send(Message::text(format!(
        r#"{{"version":1,"id":"{id}","outcome":"ok","reply":"destroyed"}}"#
    )))
    .await
    .expect("the frame is sent");

    let refused = crate::bounded(forwarding)
        .await
        .expect("the forwarding task finished");
    let Err(ForwardError::Refused { diagnostic }) = refused else {
        panic!("a reply of the wrong shape is a refusal, not a forward");
    };
    assert_eq!(diagnostic.code, DiagnosticCode::NotChecked);
    assert_eq!(
        diagnostic
            .params
            .get("unexpected")
            .and_then(|it| it.as_str()),
        Some("reply"),
        "and it names what arrived, so two ends disagreeing can be reported"
    );
}

#[tokio::test]
async fn a_write_that_fails_is_reported_on_the_frames_and_ends_the_pump() {
    // A peer that never reads, so the socket's buffer fills and the pump PARKS inside `send`. That is the
    // only way to reach a failing write: the select is biased on the socket, so a peer dropped while the
    // pump is in the select is read as an end before anything is ever written.
    let (client, peer) = crate::impersonated().await;
    let (mux, mut frames) = Mux::spawn(client);

    let payload = "x".repeat(128 * 1024);
    for _ in 0..24 {
        let mut req = serde_json::Map::new();
        req.insert("body".to_string(), payload.clone().into());
        mux.tell(Command::ProxyRequest {
            payload: Box::new(CommandProxyRequestPayload {
                connection: None,
                req,
            }),
        })
        .expect("the pump is alive and the issue channel is unbounded");
    }
    // 3 MiB against a 1 MiB buffer: by now the pump is inside a write that cannot complete.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    drop(peer);

    let reported = crate::bounded(frames.recv())
        .await
        .expect("the channel is still live")
        .expect_err("a write into a socket whose peer has gone cannot succeed");
    assert!(
        matches!(reported, cdc_client::ClientError::Disconnected),
        "a failed write is reported on the frames, which is the only place it can be — `tell` had \
         already returned: {reported:?}"
    );
    assert!(
        crate::bounded(frames.recv()).await.is_none(),
        "and the pump stops, rather than looping on a socket it can no longer write to"
    );
}

#[tokio::test]
async fn a_mux_whose_handles_are_all_dropped_ends_its_task_and_its_channel() {
    let (mux, mut frames, _shared) = attached(server(seeded())).await;
    let _ = arrival(&mut frames).await;

    drop(mux);

    // Nothing more will ever be issued and nobody is waiting, so the pump has no reason to hold a
    // socket open — and a channel that stayed open would keep a loop selecting on it forever.
    let ended = crate::bounded(async {
        loop {
            if frames.recv().await.is_none() {
                return;
            }
        }
    })
    .await;
    let () = ended;
}
