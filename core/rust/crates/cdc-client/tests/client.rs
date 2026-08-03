//! What a client of this protocol says and hears, answering to `src/client.rs`.
//!
//! **Every test here is a real WebSocket**, over a real handshake, carrying real JSON — either to the
//! real session or to a peer this test is playing. Nothing reaches into the library to place a frame
//! that could not have arrived over a socket, because what these tests are for is the claim that a Go
//! client written against `protocol.rs` would see the same thing.

use cdc_client::dial::Wire;
use cdc_client::{Client, ClientError};
use cdc_server::protocol::{Command, Event, Outbound};
use futures_util::SinkExt;
use tokio_tungstenite::tungstenite::Message;

#[path = "../../cdc-runtime/tests/fakes/mod.rs"]
mod fakes;
#[path = "../../cdc-server/tests/harness/mod.rs"]
mod harness;

#[path = "client/dial.rs"]
mod dial;
#[path = "client/embedded.rs"]
mod embedded;
#[path = "client/mux.rs"]
mod mux;
#[path = "client/tls.rs"]
mod tls;

/// A client, and the socket a test speaks into it from — a server this test is impersonating.
///
/// The real session is next door in `embedded.rs`; what this one is for is the frames a real server
/// never sends and a client must survive anyway: a version ahead, a truncated body, a binary frame.
async fn impersonated() -> (
    Client,
    tokio_tungstenite::WebSocketStream<tokio::io::DuplexStream>,
) {
    let (wire, served) = Wire::duplex();
    // Bounded like every other wait in a test: a mutant that breaks writing makes this handshake never
    // finish, and an unbounded wait under `cargo mutants` hangs a worker instead of failing it.
    let (server, client) = tokio::time::timeout(
        harness::PATIENCE,
        futures_util::future::join(
            tokio_tungstenite::accept_async(served),
            tokio_tungstenite::client_async("ws://localhost/", wire),
        ),
    )
    .await
    .expect("two halves of one process complete a handshake");
    (
        Client::new(client.expect("the client half of the handshake").0),
        server.expect("the server half of the handshake"),
    )
}

#[tokio::test]
async fn a_command_goes_out_under_an_id_the_caller_is_told() {
    let (mut client, mut server) = impersonated().await;

    let first = client
        .send(Command::ListConnections)
        .await
        .expect("the frame is sent");
    let second = client
        .send(Command::GetRuntimeSnapshot)
        .await
        .expect("the frame is sent");

    assert_eq!(
        (first.as_str(), second.as_str()),
        ("1", "2"),
        "a client issues its own correlation ids and never reuses one"
    );
    for (id, command) in [("1", "list_connections"), ("2", "get_runtime_snapshot")] {
        let frame = next_text(&mut server).await;
        let sent: serde_json::Value =
            serde_json::from_str(&frame).expect("what a client writes is JSON");
        assert_eq!(
            sent,
            serde_json::json!({ "version": 1, "id": id, "command": command }),
            "the whole frame, not its tail"
        );
    }
}

#[tokio::test]
async fn a_frame_this_client_cannot_read_is_reported_rather_than_dropped() {
    let (mut client, mut server) = impersonated().await;

    // A server one version ahead, sending a shape this client has no variant for. Silently skipping it
    // would leave a client waiting forever on a reply that had already arrived and been thrown away.
    server
        .send(Message::text(
            r#"{"version":2,"id":"1","outcome":"whatever"}"#,
        ))
        .await
        .expect("the frame is sent");

    let Some(Err(ClientError::Unreadable { frame })) = next_frame(&mut client).await else {
        panic!("an unreadable frame is an error, not a gap");
    };
    assert!(
        frame.contains(r#""version":2"#),
        "and it carries what could not be read, so it can be reported: {frame}"
    );
}

#[tokio::test]
async fn a_frame_that_is_not_text_is_skipped_rather_than_read_as_the_protocol() {
    let (mut client, mut server) = impersonated().await;

    server
        .send(Message::binary(vec![0x01, 0x02]))
        .await
        .expect("the binary frame is sent");
    server
        .send(Message::text(
            r#"{"version":1,"id":"1","outcome":"ok","reply":"destroyed"}"#,
        ))
        .await
        .expect("the text frame is sent");

    let Some(Ok(Outbound::Answer(response))) = next_frame(&mut client).await else {
        panic!("the text frame after it is delivered, not lost with it");
    };
    assert_eq!(response.id, "1");
}

#[tokio::test]
async fn a_server_that_closes_the_session_ends_the_stream() {
    let (mut client, mut server) = impersonated().await;

    server.close(None).await.expect("the session is closed");

    assert!(
        next_frame(&mut client).await.is_none(),
        "a close is the end of the frames, not an error"
    );
}

#[tokio::test]
async fn a_connection_that_breaks_is_told_apart_from_one_that_closed() {
    let (mut client, server) = impersonated().await;

    // No close frame: the peer is simply gone, which is what a killed server or a dropped network is.
    drop(server);

    assert!(
        matches!(
            next_frame(&mut client).await,
            Some(Err(ClientError::Disconnected))
        ),
        "a connection that broke is reported, where a clean close is only an end"
    );
}

#[tokio::test]
async fn sending_into_a_connection_that_is_gone_is_refused() {
    let (mut client, server) = impersonated().await;
    drop(server);

    // The first write may still be taken by the buffer the peer left behind; what must never happen is
    // that a client goes on believing it is talking to something.
    let mut refused = None;
    for _ in 0..4 {
        if let Err(error) = client.send(Command::ListConnections).await {
            refused = Some(error);
            break;
        }
    }
    assert!(
        matches!(refused, Some(ClientError::Disconnected)),
        "a send into a dead socket is refused rather than silently dropped, got {refused:?}"
    );
}

#[tokio::test]
async fn a_read_that_loses_a_race_does_not_cost_the_client_a_frame() {
    let (mut client, mut server) = impersonated().await;

    // The shape the event loop is: a read against the terminal's input, where the other arm wins and
    // the read future is dropped. If that cost anything, a client would lose frames whenever a key was
    // pressed — so this is the property [`Client::next`] claims, checked rather than asserted in prose.
    tokio::select! {
        frame = client.next() => panic!("nothing has been sent yet, got {frame:?}"),
        () = tokio::time::sleep(std::time::Duration::from_millis(5)) => {}
    }

    server
        .send(Message::text(
            r#"{"version":1,"id":"1","outcome":"ok","reply":"destroyed"}"#,
        ))
        .await
        .expect("the frame is sent");

    let Outbound::Answer(response) = frame(&mut client).await else {
        panic!("the frame is still there after the read that was dropped");
    };
    assert_eq!(response.id, "1");
}

#[tokio::test]
async fn an_endpoint_never_renders_its_token() {
    let endpoint = cdc_client::Endpoint::Remote {
        address: "example.test:9000".to_string(),
        token: secrecy::SecretString::from("s3cr3t-do-not-print"),
        tls: None,
    };
    // The same endpoint with a trust decision on it. `ClientTls` has a hand-written `Debug` and a
    // derived one would print a whole rustls config, so the claim is re-made over the value that grew.
    let secured = cdc_client::Endpoint::Remote {
        address: "example.test:9000".to_string(),
        token: secrecy::SecretString::from("s3cr3t-do-not-print"),
        tls: Some(
            cdc_client::tls::ClientTls::new("example.test:9000", &cdc_client::tls::Trust::Roots)
                .expect("a name and the built-in roots"),
        ),
    };

    let shown = format!("{endpoint} {endpoint:?} {secured} {secured:?}");

    assert!(
        !shown.contains("s3cr3t"),
        "neither Display nor Debug may leak it: {shown}"
    );
    assert!(
        shown.contains("ws://example.test:9000"),
        "and both still say where it points: {shown}"
    );
}

/// The next text frame, or a panic — a test that hangs here is a test with no message.
async fn next_text(
    server: &mut tokio_tungstenite::WebSocketStream<tokio::io::DuplexStream>,
) -> String {
    use futures_util::StreamExt;
    let message = tokio::time::timeout(harness::PATIENCE, server.next())
        .await
        .expect("the client writes within a hermetic exchange's patience")
        .expect("a frame")
        .expect("a readable frame");
    match message {
        Message::Text(text) => text.to_string(),
        other => panic!("this protocol is text: {other:?}"),
    }
}

/// The next frame, bounded.
///
/// **[`cdc_client::Client`] has no patience of its own, deliberately** — a client waits on its
/// server for as long as the user leaves it open, and a client that gave up after five seconds would
/// be a client that could not follow a log. The bound belongs to the TEST, and every wait in one has
/// to have it: an unbounded wait under `cargo mutants` hangs a worker instead of failing it, which is
/// how a mutant that stops `send` from sending costs thirty seconds rather than being killed.
async fn next_frame(client: &mut Client) -> Option<Result<Outbound, ClientError>> {
    tokio::time::timeout(harness::PATIENCE, client.next())
        .await
        .expect("the server answers within a hermetic exchange's patience")
}

/// Any wait, bounded — see [`next_frame`] for why every wait in a test is.
///
/// A mutant that breaks writing makes a handshake that can never finish, and this is where that turns
/// into a failure rather than a hung mutation worker.
async fn bounded<F: std::future::Future>(work: F) -> F::Output {
    tokio::time::timeout(harness::PATIENCE, work)
        .await
        .expect("an exchange between two halves of one machine finishes within this patience")
}

/// Reach a server, bounded.
async fn connect(endpoint: &cdc_client::Endpoint) -> Result<Client, ClientError> {
    bounded(Client::connect(endpoint)).await
}

/// The next frame, which must be there and must be readable.
async fn frame(client: &mut Client) -> Outbound {
    next_frame(client)
        .await
        .expect("a frame, not the end of the session")
        .expect("a readable frame")
}

/// The next reply, skipping whatever was pushed on the way.
///
/// A client that expected its answer first would deadlock against its own server: progress lines and
/// snapshots genuinely arrive between a request and the response to it.
async fn reply_to(client: &mut Client, id: &str) -> cdc_server::protocol::Response {
    tokio::time::timeout(harness::PATIENCE, async {
        loop {
            match client.next().await {
                Some(Ok(Outbound::Answer(response))) => return response,
                Some(Ok(Outbound::Pushed(_))) => continue,
                other => panic!("expected a reply to {id}, got {other:?}"),
            }
        }
    })
    .await
    .expect("a reply arrives within a hermetic exchange's patience")
}

/// The one push every attaching client is handed, as the thing a test asserts against.
fn handed_state(
    outbound: Outbound,
) -> Box<cdc_runtime::domain::types::resource_sync_protocol::AppRuntimeSnapshot> {
    let Outbound::Pushed(push) = outbound else {
        panic!("a client is handed state on arrival, not a reply");
    };
    let Event::Snapshot { snapshot } = push.event else {
        panic!("and that state is a snapshot");
    };
    snapshot
}
