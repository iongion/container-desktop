//! What an accepted socket becomes — the half of `src/listen/endpoint.rs` that runs after a listener
//! has a stream in hand: the upgrade, the token at the door of one listener and not the other, the
//! deadline a peer that says nothing is let go of by, and the TLS wrap under all of it.
//!
//! Split out of [`super`] because the file went past the 620-line cap, and split HERE because this is
//! the seam the source itself has: everything above is `bind`/`release` and everything here is
//! `accept`/`attach`/`handshake`. The fixtures both halves need stay in the parent.

use std::sync::Arc;

use cdc_server::listen::endpoint::Serving;
use cdc_server::listen::session::Shared;
use cdc_server::protocol::{Command, Event, Outbound, Reply, Request};
use tokio_util::sync::CancellationToken;

use super::{local_only, remote_only, secured};
use crate::harness::{
    CONNECTION, PATIENCE, certified, engine_is_bound, local_client, remote_client, replied,
    running_server, secure_remote_client, seeded, server, short_tempdir, trusting,
};

/// A handshake deadline a test can wait through.
///
/// **Fifty milliseconds rather than the ten seconds a listener runs with**, and the direction it can be
/// wrong in is the safe one: load makes a deadline fire LATER, never sooner, and what waits on it is
/// [`PATIENCE`], a hundred times longer. Deliberately nothing that has to complete a real handshake
/// shares it — a legitimate client racing fifty milliseconds is a test that passes alone and fails
/// beside a mutation run, which is load reported as a defect.
const A_DEADLINE_A_TEST_CAN_WAIT_FOR: std::time::Duration = std::time::Duration::from_millis(50);

/// How much a peer read before end-of-file, bounded.
///
/// **Zero is the assertion**: it means the far end closed, which is the difference between a socket the
/// server let go of and one it is still politely holding a task open for. Bounded because the failure
/// this guards against is a deadline that never fires, and an unbounded wait for one hangs a mutation
/// worker instead of failing it.
async fn bytes_before_end_of_file<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> usize {
    tokio::time::timeout(
        PATIENCE,
        tokio::io::AsyncReadExt::read(stream, &mut [0u8; 1]),
    )
    .await
    .expect("the deadline passes well within a test's patience")
    .expect("the socket is readable")
}

#[tokio::test]
async fn a_client_on_the_local_socket_reaches_the_protocol() {
    // The exit criterion in miniature, over fakes: a client attaches to a socket, is handed the
    // state, and issues a command that is answered.
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let serving = Serving::bind(
        Shared::new(server(seeded()), shutdown.clone()),
        &local_only(&path),
    )
    .await
    .expect("the socket binds");
    let accepting = tokio::spawn(serving.run());

    let mut client = local_client(&path).await;
    let first = client.next().await;
    client
        .send(&Request::new("1", Command::ListConnections))
        .await;
    let Reply::Connections { connections } = replied(client.reply_to("1").await) else {
        panic!("expected the connections");
    };

    assert!(matches!(
        first,
        Outbound::Pushed(push) if matches!(push.event, Event::Snapshot { .. })
    ));
    assert_eq!(connections.len(), 1);
    shutdown.cancel();
    tokio::time::timeout(PATIENCE, accepting)
        .await
        .expect("the run ends when it is told to")
        .expect("without panicking");
}

#[tokio::test]
async fn a_remote_client_with_the_token_reaches_the_same_protocol() {
    // "Identical envelopes on both": the same first frame and the same reply as the local socket gives,
    // through the same session code. The only difference is who was asked for a token.
    let shutdown = CancellationToken::new();
    let serving = Serving::bind(
        Shared::new(server(seeded()), shutdown.clone()),
        &remote_only("s3cret"),
    )
    .await
    .expect("port 0 binds");
    let address = serving.remote_address().expect("a bound address");
    let accepting = tokio::spawn(serving.run());

    let mut client = remote_client(address, Some("Bearer s3cret"))
        .await
        .expect("the token is right");
    let first = client.next().await;
    client
        .send(&Request::new("1", Command::ListConnections))
        .await;

    assert!(matches!(
        first,
        Outbound::Pushed(push) if matches!(push.event, Event::Snapshot { .. })
    ));
    replied(client.reply_to("1").await);
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn a_remote_client_without_a_token_never_becomes_a_client() {
    // Refused during the upgrade, so it gets no id, no snapshot and no place on the roster. A 401 rather
    // than a dropped connection, so a client library can tell "you need a token" from "this is not a
    // WebSocket endpoint".
    let shutdown = CancellationToken::new();
    let shared = Shared::new(server(seeded()), shutdown.clone());
    let serving = Serving::bind(Arc::clone(&shared), &remote_only("s3cret"))
        .await
        .expect("bound");
    let address = serving.remote_address().expect("a bound address");
    let accepting = tokio::spawn(serving.run());

    let refused = remote_client(address, None).await;
    let wrong = remote_client(address, Some("Bearer nearly-s3cret")).await;
    let other_scheme = remote_client(address, Some("Basic s3cret")).await;

    for (what, outcome) in [
        ("no header", refused),
        ("the wrong token", wrong),
        ("another scheme", other_scheme),
    ] {
        match outcome {
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => assert_eq!(
                response.status(),
                tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED,
                "{what} must be a 401"
            ),
            other => panic!("{what} was not refused: {other:?}"),
        }
    }
    assert_eq!(
        shared.clients.count(),
        0,
        "and not one of them reached the roster"
    );
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn a_peer_that_says_nothing_is_let_go_of() {
    // Without a deadline, anything that can open a socket can hold a task and a file descriptor by saying
    // nothing, as many times as it likes. At the DEFAULT deadline this asserts the shape rather than the
    // wait — the connection is accepted, no client appears, and the server is unharmed. That the socket
    // is then let go of is the two tests below, which choose a deadline they can wait for.
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let shared = Shared::new(server(seeded()), shutdown.clone());
    let serving = Serving::bind(Arc::clone(&shared), &local_only(&path))
        .await
        .expect("bound");
    let accepting = tokio::spawn(serving.run());

    let silent = tokio::net::UnixStream::connect(&path)
        .await
        .expect("accepted");
    // A client that DOES speak, to prove the listener is still serving while the silent one hangs.
    let mut talking = local_client(&path).await;
    talking.next().await;
    talking
        .send(&Request::new("1", Command::ListConnections))
        .await;
    replied(talking.reply_to("1").await);

    assert_eq!(
        shared.clients.count(),
        1,
        "the silent peer is not a client, and the talking one is"
    );
    drop(silent);
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn a_peer_that_never_speaks_is_let_go_of_when_the_deadline_passes() {
    // The half of the test above that ten seconds puts out of reach, and it is the half the deadline
    // exists for: the socket is not merely kept off the roster, it is CLOSED. "No client appeared" is
    // equally true of a peer the server is still holding a task and a file descriptor open for, which is
    // exactly the state a silent peer is supposed to be unable to buy.
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let shared = Shared::with_handshake_timeout(
        server(seeded()),
        shutdown.clone(),
        A_DEADLINE_A_TEST_CAN_WAIT_FOR,
    );
    let serving = Serving::bind(Arc::clone(&shared), &local_only(&path))
        .await
        .expect("bound");
    let accepting = tokio::spawn(serving.run());

    let mut silent = tokio::net::UnixStream::connect(&path)
        .await
        .expect("accepted");

    assert_eq!(
        bytes_before_end_of_file(&mut silent).await,
        0,
        "the server let the socket go rather than waiting on it forever"
    );
    assert_eq!(shared.clients.count(), 0, "and it never became a client");
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn a_peer_that_opens_a_tls_connection_and_says_nothing_is_let_go_of_too() {
    // The TLS handshake carries a deadline of its own because it is the cheaper attack: a peer that
    // abandons one mid-way has already made the server do asymmetric crypto, where a silent plaintext
    // socket costs it a file descriptor. **A connection with no ClientHello on it at all**, which is a
    // different peer from the plaintext client below — that one says something the listener cannot read
    // and is refused for saying it. This one says nothing, and only the clock ends it.
    let shutdown = CancellationToken::new();
    let (admitted, _material) = secured("s3cret");
    let shared = Shared::with_handshake_timeout(
        server(seeded()),
        shutdown.clone(),
        A_DEADLINE_A_TEST_CAN_WAIT_FOR,
    );
    let serving = Serving::bind(Arc::clone(&shared), &admitted)
        .await
        .expect("bound");
    let address = serving.remote_address().expect("a bound address");
    let accepting = tokio::spawn(serving.run());

    let mut silent = tokio::net::TcpStream::connect(address)
        .await
        .expect("the port is being served");

    assert_eq!(
        bytes_before_end_of_file(&mut silent).await,
        0,
        "the wrap is under the same deadline the upgrade above it is"
    );
    assert_eq!(shared.clients.count(), 0, "and it never became a client");
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn a_buffered_forward_starts_no_pump() {
    // The other arm of "did this open a stream": a plain GET answers whole, so there is nothing to pump
    // and nothing to reap. A pump started here would hold an engine connection nobody asked for.
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let shared = Shared::new(running_server(engine_is_bound()), shutdown.clone());
    let serving = Serving::bind(Arc::clone(&shared), &local_only(&path))
        .await
        .expect("bound");
    let accepting = tokio::spawn(serving.run());
    let mut client = local_client(&path).await;
    client.next().await;

    client
        .send(&Request::new(
            "1",
            crate::harness::proxy(
                Some(CONNECTION),
                serde_json::json!({ "url": "/_ping", "method": "GET" }),
            ),
        ))
        .await;
    replied(client.reply_to("1").await);

    assert!(
        shared.streams.is_empty(),
        "a buffered answer holds nothing open"
    );
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn a_remote_client_over_tls_reaches_the_same_protocol() {
    // The claim `wss://` is FOR, and it is the same claim the plaintext remote listener makes two tests
    // up: identical envelopes. TLS is a layer under the stream, so the handshake, the session and the
    // frames above it are the same lines — and a test that could not tell them apart would be no test at
    // all, which is why this one drives a real command and reads its reply.
    let shutdown = CancellationToken::new();
    let (admitted, material) = secured("s3cret");
    let serving = Serving::bind(Shared::new(server(seeded()), shutdown.clone()), &admitted)
        .await
        .expect("port 0 binds");
    let address = serving.remote_address().expect("a bound address");
    let accepting = tokio::spawn(serving.run());

    let mut client = secure_remote_client(
        address,
        &trusting(&material.certificate),
        Some("Bearer s3cret"),
    )
    .await
    .expect("the certificate is trusted and the token is right");
    let first = client.next().await;
    client
        .send(&Request::new("1", Command::ListConnections))
        .await;
    let Reply::Connections { connections } = replied(client.reply_to("1").await) else {
        panic!("expected the connections");
    };

    assert!(matches!(
        first,
        Outbound::Pushed(push) if matches!(push.event, Event::Snapshot { .. })
    ));
    assert_eq!(connections.len(), 1);
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn tls_is_not_a_way_past_the_token() {
    // The failure mode worth naming: encryption and authentication are different questions, and a
    // listener that treated a completed TLS handshake as evidence of anything about the CLIENT would
    // have swapped one for the other. The token check is above the wrap, so it is the same check —
    // asserted rather than assumed, because "it is the same code" is exactly what stops being true.
    let shutdown = CancellationToken::new();
    let (admitted, material) = secured("s3cret");
    let shared = Shared::new(server(seeded()), shutdown.clone());
    let serving = Serving::bind(Arc::clone(&shared), &admitted)
        .await
        .expect("bound");
    let address = serving.remote_address().expect("a bound address");
    let accepting = tokio::spawn(serving.run());
    let connector = trusting(&material.certificate);

    let none = secure_remote_client(address, &connector, None).await;
    let wrong = secure_remote_client(address, &connector, Some("Bearer nearly-s3cret")).await;

    for (what, outcome) in [("no header", none), ("the wrong token", wrong)] {
        match outcome {
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => assert_eq!(
                response.status(),
                tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED,
                "{what} must be a 401 over TLS too"
            ),
            other => panic!("{what} was not refused: {other:?}"),
        }
    }
    assert_eq!(shared.clients.count(), 0, "and neither reached the roster");
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn a_client_that_does_not_trust_the_certificate_never_becomes_one() {
    // And the server is unharmed by it, which is the other half: a refused TLS handshake happens inside
    // the spawned task, so it costs one task and never the listener. The second client proves the
    // listener is still serving.
    let shutdown = CancellationToken::new();
    let (admitted, material) = secured("s3cret");
    let shared = Shared::new(server(seeded()), shutdown.clone());
    let serving = Serving::bind(Arc::clone(&shared), &admitted)
        .await
        .expect("bound");
    let address = serving.remote_address().expect("a bound address");
    let accepting = tokio::spawn(serving.run());
    let stranger = certified(&["localhost"]);

    let refused = secure_remote_client(
        address,
        &trusting(&stranger.certificate),
        Some("Bearer s3cret"),
    )
    .await;
    let mut accepted = secure_remote_client(
        address,
        &trusting(&material.certificate),
        Some("Bearer s3cret"),
    )
    .await
    .expect("the right certificate still gets in");
    accepted.next().await;

    assert!(
        matches!(refused, Err(tokio_tungstenite::tungstenite::Error::Io(_))),
        "an untrusted certificate fails below the WebSocket, so it is an I/O error: {refused:?}"
    );
    assert_eq!(
        shared.clients.count(),
        1,
        "only the client that trusted it is on the roster"
    );
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn a_plaintext_client_on_a_tls_listener_never_becomes_one() {
    // What proves the wrap is actually in the path rather than configured and skipped. A `ws://` client
    // sends an HTTP request where a ClientHello belongs; the listener cannot read it, and the connection
    // ends without a client — while the listener carries on.
    let shutdown = CancellationToken::new();
    let (admitted, material) = secured("s3cret");
    let shared = Shared::new(server(seeded()), shutdown.clone());
    let serving = Serving::bind(Arc::clone(&shared), &admitted)
        .await
        .expect("bound");
    let address = serving.remote_address().expect("a bound address");
    let accepting = tokio::spawn(serving.run());

    let in_the_clear = remote_client(address, Some("Bearer s3cret")).await;
    let mut secure = secure_remote_client(
        address,
        &trusting(&material.certificate),
        Some("Bearer s3cret"),
    )
    .await
    .expect("and TLS still gets in");
    secure.next().await;

    assert!(
        in_the_clear.is_err(),
        "a plaintext client cannot reach a TLS listener"
    );
    assert_eq!(shared.clients.count(), 1, "only the TLS one is a client");
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}
