//! One client, over the wire it will really use.
//!
//! **These tests are CLIENTS.** Each one completes a real WebSocket handshake over an in-memory duplex and
//! then exchanges JSON envelopes — nothing reaches into the library to shortcut a frame. So what they
//! pin is what a client written against `protocol.rs` in any language would see, which is the property
//! rests on: the wire values are pinned by tests that assert JSON, because a `serde` round-trip
//! only ever agrees with itself.

use std::sync::Arc;

use cdc_runtime::domain::types::command_proxy_protocol::{CommandProxyResult, StreamEventType};
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::resource_sync_protocol::{
    ConnectOrigin, ConnectionPhase, ConnectionStartingStep,
};
use cdc_server::listen::CLIENT_QUEUE_CAPACITY;
use cdc_server::listen::session::{self, Shared};
use cdc_server::protocol::{Command, Event, Outbound, Push, Reply, Request};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

use crate::fakes::{Gate, MemoryFs};
use crate::harness::{
    CONNECTION, PATIENCE, TestClient, connected_pair, engine_is_bound, gated_server, proxy,
    refused, replied, running_server, seeded, server, streaming_server,
};

/// A served session and a client attached to it, over the fake world the harness builds.
///
/// The `Attached` handle comes back too: shutdown cancels clients through the roster, and a test that
/// wants to assert what that does to a session needs the same handle the roster holds.
macro_rules! attached_client {
    ($server:expr) => {{
        let shared = Shared::new($server, CancellationToken::new());
        let (socket, client) = connected_pair().await;
        let attached = shared.clients.attach("test", CLIENT_QUEUE_CAPACITY);
        let session = tokio::spawn(session::serve(
            socket,
            Arc::clone(&attached),
            Arc::clone(&shared),
        ));
        (shared, client, attached, session)
    }};
}

/// One more client on an existing server — the two-clients-at-once case.
async fn second_client<F, B, C>(
    shared: &Arc<Shared<F, B, C>>,
) -> (
    TestClient<tokio::io::DuplexStream>,
    tokio::task::JoinHandle<()>,
)
where
    F: cdc_runtime::capabilities::fs::FsLocks + Send + 'static,
    B: cdc_server::server::MachineBuilder + 'static,
    C: cdc_runtime::capabilities::clock::Clock + 'static,
{
    let (socket, client) = connected_pair().await;
    let attached = shared.clients.attach("test", CLIENT_QUEUE_CAPACITY);
    let session = tokio::spawn(session::serve(socket, attached, Arc::clone(shared)));
    (client, session)
}

fn snapshot_of(
    push: &Push,
) -> &cdc_runtime::domain::types::resource_sync_protocol::AppRuntimeSnapshot {
    match &push.event {
        Event::Snapshot { snapshot } => snapshot,
        other => panic!("expected a snapshot, got {other:?}"),
    }
}

#[tokio::test]
async fn an_attaching_client_is_handed_the_state_before_it_asks_for_anything() {
    // Each client gets a full snapshot on connect, then pushes. Offered rather than
    // published, so a second client attaching to unchanged state still receives it.
    let (_shared, mut client, _attached, _session) = attached_client!(server(seeded()));

    let first = client.next_push().await;

    let snapshot = snapshot_of(&first);
    assert_eq!(snapshot.connections.len(), 1);
    assert_eq!(
        snapshot.os_type, "Linux",
        "the oracle's own spelling — `os.type()`, not a lowercased one"
    );
    assert!(snapshot.running);
}

#[tokio::test]
async fn a_client_is_told_an_attempt_is_running_while_it_is_still_running() {
    // **End to end, over a real socket, with the attempt genuinely stopped in the middle.** Every
    // other test of this can be satisfied by a server that publishes when the attempt is over; only a
    // gate can tell the two apart, because it holds the connect exactly where a real one spends its 51
    // to 56 seconds — inside `spawn_service`, polling a socket that has not answered yet.
    //
    // This is the whole chain: the machine publishes a line, `Held` writes the projection, `Shared`
    // fans out through the one path every other producer uses, and it reaches a client's socket.
    let gate = Gate::shut();
    let (_shared, mut client, _attached, _session) =
        attached_client!(gated_server(engine_is_bound(), gate.clone()));
    client.next_push().await;

    client
        .send(&Request::new(
            "1",
            Command::Connect {
                connection_id: CONNECTION.to_string(),
                origin: ConnectOrigin::User,
            },
        ))
        .await;
    // BOUNDED, for the reason every gate in this workspace is: a mutant that stops the connect ever
    // starting would hang a worker here instead of failing it.
    tokio::time::timeout(PATIENCE, gate.reached())
        .await
        .expect("the attempt reached the engine");

    // Four frames, and no more can arrive: nothing has opened the gate. Every line moves the
    // projection now that it carries the sub-step, so three states were published — but a client that
    // has not drained gets ONE, because unread state is SUPERSEDED while a trace never is
    // (`Admission::Superseded`). So the snapshot lands last and carries the newest of the three,
    // which is the sub-step the attempt is actually standing in.
    let told = [
        client.next_push().await,
        client.next_push().await,
        client.next_push().await,
        client.next_push().await,
    ];
    assert_eq!(
        told.iter()
            .filter_map(|push| match &push.event {
                Event::Progress { progress } => Some(progress.step),
                _ => None,
            })
            .collect::<Vec<_>>(),
        vec![
            None,
            Some(ConnectionStartingStep::Detecting),
            Some(ConnectionStartingStep::StartingApi),
        ],
        "the attempt announcing itself, and then each sub-step as it was entered: {told:?}"
    );
    let state = told
        .iter()
        .find(|push| matches!(push.event, Event::Snapshot { .. }))
        .map(snapshot_of)
        .expect("the state those lines were narrating");
    let rendered = state
        .active
        .as_ref()
        .and_then(|active| active.first())
        .expect("the connection the attempt is for");
    assert_eq!(
        rendered.phase,
        ConnectionPhase::Starting,
        "and what a client renders says the connection is starting, not what it was before"
    );
    assert_eq!(
        rendered.starting_step,
        Some(ConnectionStartingStep::StartingApi),
        "and WHICH sub-step — the one the attempt is standing in, from the snapshot alone. A client \
         that attached here heard none of the lines above it, and `starting` is equally true of all \
         four sub-steps and of the minute the third of them can take"
    );

    gate.open();
    assert!(matches!(
        replied(client.reply_to("1").await),
        Reply::Snapshot { .. }
    ));
}

#[tokio::test]
async fn a_command_is_answered_with_the_id_it_carried() {
    let (_shared, mut client, _attached, _session) = attached_client!(server(seeded()));
    client.next_push().await;

    client
        .send(&Request::new("abc-1", Command::ListConnections))
        .await;

    let Reply::Connections { connections } = replied(client.reply_to("abc-1").await) else {
        panic!("expected the connections");
    };
    assert_eq!(connections.len(), 1);
}

#[tokio::test]
async fn a_command_that_changed_nothing_publishes_nothing() {
    // A snapshot after every command would keep a bounded queue busy for no information. The rule is
    // "publish when it moved", and a listing moves nothing.
    let (_shared, mut client, _attached, _session) = attached_client!(server(seeded()));
    client.next_push().await;

    client
        .send(&Request::new("1", Command::ListConnections))
        .await;
    let first = client.next().await;

    assert!(
        matches!(first, Outbound::Answer(_)),
        "the reply is the very next frame: {first:?}"
    );
}

#[tokio::test]
async fn a_frame_that_is_not_json_is_refused_and_the_session_survives() {
    // A client bug must not cost the session. It costs the CALL, and the call is named.
    let (_shared, mut client, _attached, _session) = attached_client!(server(seeded()));
    client.next_push().await;

    client.send_raw(Message::text("{ not json")).await;

    let diagnostic = refused(client.next_response().await);
    assert_eq!(diagnostic.code, DiagnosticCode::RequestInvalid);
    assert_eq!(
        diagnostic.params.get("field").and_then(|it| it.as_str()),
        Some("frame")
    );

    client
        .send(&Request::new("after", Command::ListConnections))
        .await;
    replied(client.reply_to("after").await);
}

#[tokio::test]
async fn a_protocol_version_this_server_does_not_speak_is_refused_before_the_command_is_read() {
    // The version tag has to MEAN something from the first release, or it is decoration nobody can
    // retrofit. A frame at another version may parse into a shape that looks right, and answering it
    // would be worse than refusing it.
    let (_shared, mut client, _attached, _session) = attached_client!(server(seeded()));
    client.next_push().await;

    client
        .send_raw(Message::text(
            r#"{"version":2,"id":"v2","command":"list_connections"}"#,
        ))
        .await;

    let response = client.next_response().await;
    assert_eq!(response.id, "v2", "the correlation id is echoed back");
    let diagnostic = refused(response);
    assert_eq!(diagnostic.code, DiagnosticCode::RequestInvalid);
    assert_eq!(
        diagnostic.params.get("field").and_then(|it| it.as_str()),
        Some("version")
    );
    assert_eq!(
        diagnostic.params.get("expected").and_then(|it| it.as_u64()),
        Some(1),
        "and it says which version this server does speak"
    );
}

#[tokio::test]
async fn an_unknown_command_fails_the_call_rather_than_the_session() {
    let (_shared, mut client, _attached, _session) = attached_client!(server(seeded()));
    client.next_push().await;

    client
        .send_raw(Message::text(
            r#"{"version":1,"id":"nope","command":"take_over_the_world"}"#,
        ))
        .await;

    let response = client.next_response().await;
    assert_eq!(response.id, "nope");
    assert_eq!(
        refused(response)
            .params
            .get("field")
            .and_then(|it| it.as_str()),
        Some("command")
    );
}

#[tokio::test]
async fn a_frame_with_no_id_at_all_is_still_answered() {
    // There is nothing honest to echo, so an empty id is what comes back — but an answer comes back,
    // because a client that receives nothing cannot tell a refusal from a server that has stopped.
    let (_shared, mut client, _attached, _session) = attached_client!(server(seeded()));
    client.next_push().await;

    client.send_raw(Message::text("[]")).await;

    let response = client.next_response().await;
    assert!(response.id.is_empty());
    assert_eq!(refused(response).code, DiagnosticCode::RequestInvalid);
}

#[tokio::test]
async fn a_binary_frame_is_refused_the_way_any_unreadable_one_is() {
    // A client sending binary is speaking something else. One rule for "I could not read that", rather
    // than a second path that closes the connection.
    let (_shared, mut client, _attached, _session) = attached_client!(server(seeded()));
    client.next_push().await;

    client.send_raw(Message::binary(vec![0x01, 0x02])).await;
    client
        .send(&Request::new("after", Command::ListConnections))
        .await;

    replied(client.reply_to("after").await);
}

#[tokio::test]
async fn an_unreadable_document_is_reported_to_a_client_that_has_just_attached() {
    // The file is shared with the desktop app, so an unreadable one is a real state. A session that
    // simply sent nothing would leave a client holding a connection with no state and no explanation.
    let (_shared, mut client, _attached, _session) =
        attached_client!(server(MemoryFs::seeded(SETTINGS_PATH, "{ not json")));

    let diagnostic = refused(client.next_response().await);

    assert_eq!(diagnostic.code, DiagnosticCode::NotChecked);
}

const SETTINGS_PATH: &str = "/home/tester/.config/container-desktop/user-settings.json";

#[tokio::test]
async fn progress_reaches_a_client_that_did_not_ask_for_it() {
    // The reason a client attaches rather than polls, and the reason fan-out is the roster's job: a
    // client that only heard about its own commands would render a workspace where nothing anybody else
    // did ever happened.
    let (shared, mut first, _attached, _session) =
        attached_client!(running_server(engine_is_bound()));
    let (mut second, _second_session) = second_client(&shared).await;
    first.next_push().await;
    second.next_push().await;

    first
        .send(&Request::new(
            "1",
            Command::Connect {
                connection_id: CONNECTION.to_string(),
                origin: ConnectOrigin::User,
            },
        ))
        .await;
    replied(first.reply_to("1").await);

    let mut progress_lines = 0;
    let mut snapshots = 0;
    while let Some(text) = second.next_text().await {
        match serde_json::from_str::<Outbound>(&text).expect("a client can parse it") {
            Outbound::Pushed(push) => match push.event {
                Event::Progress { .. } => progress_lines += 1,
                Event::Snapshot { .. } => {
                    snapshots += 1;
                    break;
                }
                Event::Stream { .. } => panic!("no stream was opened"),
            },
            Outbound::Answer(response) => {
                panic!("the other client's reply arrived here: {response:?}")
            }
        }
        assert!(
            progress_lines < 50,
            "bounded: an unbounded drain under cargo mutants is an OOM, not a failure"
        );
    }
    assert!(
        progress_lines > 0,
        "the connect trace is a log, and it goes to everyone"
    );
    assert_eq!(snapshots, 1, "then the state those lines were narrating");
}

/// A data frame's payload back into text — the client half of `streams::carried`.
///
/// The wire carries the chunk's BYTES, because a container log frame's header is binary and a string
/// could not hold it. A client that wants text decodes, which is what the original's `toLogBytes` does.
fn text_of(payload: serde_json::Value) -> String {
    let bytes: Vec<u8> = payload
        .as_array()
        .expect("a chunk is carried as its bytes")
        .iter()
        .map(|byte| u8::try_from(byte.as_u64().expect("a byte value")).expect("a byte value"))
        .collect();
    String::from_utf8(bytes).expect("this fixture's chunks are text")
}

#[tokio::test]
async fn a_forwarded_stream_arrives_after_the_handle_that_names_it() {
    // The ordering is the whole reason one queue exists: a chunk that reached a client before the id it
    // is keyed by would be a chunk with nowhere to go.
    let (_shared, mut client, _attached, _session) =
        attached_client!(streaming_server(engine_is_bound(), &["first", "second"]));
    client.next_push().await;

    client
        .send(&Request::new(
            "s1",
            proxy(
                Some(CONNECTION),
                serde_json::json!({ "url": "/events", "responseType": "stream" }),
            ),
        ))
        .await;

    let Reply::Proxied { result } = replied(client.reply_to("s1").await) else {
        panic!("expected a forwarded answer");
    };
    let CommandProxyResult::Stream(handle) = *result else {
        panic!("a streamed request answers with a handle");
    };
    assert_eq!(handle.stream_id, "cps-1", "the original's own id shape");

    let mut delivered = Vec::new();
    let mut ended = false;
    while !ended {
        let push = client.next_push().await;
        let Event::Stream { stream } = push.event else {
            continue;
        };
        assert_eq!(stream.stream_id, handle.stream_id);
        match stream.type_ {
            StreamEventType::Data => delivered.push(text_of(
                stream.payload.expect("a data frame carries its chunk"),
            )),
            StreamEventType::End => ended = true,
            StreamEventType::Error => panic!("the fake engine did not fail"),
        }
        assert!(
            delivered.len() <= 8,
            "bounded, always: an unbounded drain is how a mutant OOM-kills a whole run"
        );
    }
    assert_eq!(delivered, vec!["first", "second"]);
}

#[tokio::test]
async fn a_client_that_goes_away_takes_its_streams_and_leaves_its_connection() {
    // `disposeForSender`, one layer out: a window closing while a log view is open must not leak a live
    // engine stream, and must not take the engine down with it. The asymmetry is why a server exists.
    let (shared, mut client, _attached, session) =
        attached_client!(streaming_server(engine_is_bound(), &["a line"]));
    client.next_push().await;
    client
        .send(&Request::new(
            "s1",
            proxy(
                Some(CONNECTION),
                serde_json::json!({ "url": "/events", "responseType": "stream" }),
            ),
        ))
        .await;
    replied(client.reply_to("s1").await);

    drop(client);
    tokio::time::timeout(PATIENCE, session)
        .await
        .expect("the session ends when its client does")
        .expect("without panicking");

    assert!(
        shared.streams.is_empty(),
        "the stream it was holding is reaped"
    );
    assert_eq!(shared.clients.count(), 0, "and it is off the roster");
    let snapshot = shared.server.snapshot().expect("the document is readable");
    assert!(
        snapshot.active.is_some(),
        "while the connection it was using is still up: {snapshot:?}"
    );
}

#[tokio::test]
async fn a_cancelled_client_is_closed_rather_than_dropped() {
    // What shutdown does to every session (`Clients::cancel_all`). A close frame is the difference
    // between "the server is finished with you" and a connection that simply stopped answering.
    let (_shared, mut client, attached, session) = attached_client!(server(seeded()));
    client.next_push().await;

    attached.cancel();

    assert!(
        client.next_text().await.is_none(),
        "the client is told, in the protocol's own terms"
    );
    tokio::time::timeout(PATIENCE, session)
        .await
        .expect("and the session task finishes")
        .expect("without panicking");
}

#[tokio::test]
async fn a_client_that_says_goodbye_is_let_go_of() {
    // The other direction of the same courtesy, and the way out a well-behaved client actually takes: a
    // close frame rather than a vanished socket. What has to follow is the session ENDING — off the
    // roster, its streams reaped — because a goodbye read as one more frame this protocol does not
    // carry would leave the task, the queue and the roster entry standing for a client that has left.
    let (shared, mut client, _attached, session) = attached_client!(server(seeded()));
    client.next_push().await;
    assert_eq!(shared.clients.count(), 1, "attached before it leaves");

    client.send_raw(Message::Close(None)).await;

    tokio::time::timeout(PATIENCE, session)
        .await
        .expect("the session ends on the client's own say-so")
        .expect("without panicking");
    assert_eq!(
        shared.clients.count(),
        0,
        "and nothing is held for a client that has gone"
    );
}
