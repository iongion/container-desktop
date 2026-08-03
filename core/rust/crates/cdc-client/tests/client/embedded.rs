//! A server in this process, answering to `src/client/embedded.rs`.
//!
//! **The exit criterion this file exists for is the last test in it**: the same malformed frame down
//! the embedded transport and down a real socket, refused the same way. That is what buys by
//! forbidding an in-process shortcut, and it is only worth anything if something checks it — an
//! in-process path that passed native values would refuse nothing, and the divergence would surface
//! the first time someone attached remotely.

use std::sync::Arc;

use cdc_client::embedded;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_server::listen::auth::Token;
use cdc_server::listen::endpoint::Serving;
use cdc_server::listen::session::Shared;
use cdc_server::listen::{Admitted, Listen, Remote};
use cdc_server::protocol::{Command, Outcome, Reply};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

use crate::harness::{CONNECTION, TestClient, replied, seeded, server};

/// A frame no client would send on purpose: valid JSON, and not a request.
const MALFORMED: &str = r#"{"version":1,"id":"7","command":"invent_a_connection"}"#;

#[tokio::test]
async fn an_embedded_client_is_handed_the_state_and_answered() {
    let shutdown = CancellationToken::new();
    let shared = Shared::new(server(seeded()), shutdown.clone());
    let mut client = crate::bounded(embedded::attach(Arc::clone(&shared)))
        .await
        .expect("a server in this process is always reachable");

    assert_eq!(client.transport(), "embedded");
    let snapshot = crate::handed_state(crate::frame(&mut client).await);
    assert_eq!(
        snapshot.connections.len(),
        1,
        "the same arrival a socket client gets: {snapshot:?}"
    );

    let id = client
        .send(Command::ListConnections)
        .await
        .expect("the frame is sent");
    let response = crate::reply_to(&mut client, &id).await;
    assert_eq!(response.id, id, "a reply carries the id it answers");
    let Reply::Connections { connections } = replied(response) else {
        panic!("list_connections answers with the list");
    };
    assert_eq!(
        connections.first().map(|it| it.id.as_str()),
        Some(CONNECTION),
        "and it is the document's, read through the protocol rather than around it"
    );
}

#[tokio::test]
async fn an_embedded_session_stops_with_the_server_it_belongs_to() {
    let shutdown = CancellationToken::new();
    let shared = Shared::new(server(seeded()), shutdown.clone());
    let mut client = crate::bounded(embedded::attach(Arc::clone(&shared)))
        .await
        .expect("a server in this process is always reachable");
    let _ = crate::frame(&mut client).await;

    // What `Serving::run` does on the way out, which an embedded session is spawned onto the same
    // tracker for: ask every client to go, then wait for the tasks that were mid-frame.
    shared.clients.cancel_all();
    shared.tasks.close();
    tokio::time::timeout(crate::harness::PATIENCE, shared.tasks.wait())
        .await
        .expect("a session that was asked to stop does not have to be waited out");

    assert_eq!(
        shared.clients.count(),
        0,
        "and it let go of its place in the roster"
    );
}

#[tokio::test]
async fn a_pipe_nobody_speaks_into_costs_the_server_nothing() {
    let shutdown = CancellationToken::new();
    let shared = Shared::new(server(seeded()), shutdown.clone());

    // The caller took the pipe and went away before saying anything — a client that failed to start, or a
    // handshake this process abandoned. The session must end rather than hold a task, and it must never
    // reach the roster, because a client that never attached has nothing to be sent.
    drop(embedded::pipe(Arc::clone(&shared)));

    shared.tasks.close();
    tokio::time::timeout(crate::harness::PATIENCE, shared.tasks.wait())
        .await
        .expect("the session gives up rather than waiting on a peer that is gone");
    assert_eq!(
        shared.clients.count(),
        0,
        "and it never took a place in the roster"
    );
}

#[tokio::test]
async fn embedded_and_remote_refuse_the_same_malformed_message() {
    let shutdown = CancellationToken::new();

    // The embedded transport, spoken to directly: a pipe with a real handshake over it, so a frame
    // this client would never build can still be put on the wire.
    let embedded_shared = Shared::new(server(seeded()), shutdown.clone());
    let (embedded_socket, _) = crate::bounded(tokio_tungstenite::client_async(
        "ws://localhost/",
        embedded::pipe(embedded_shared),
    ))
    .await
    .expect("the in-process handshake");
    let mut over_pipe = TestClient::new(embedded_socket);

    // A real listener on a real port, guarded by a real token.
    let admitted = Admitted::admit(Listen {
        local: None,
        remote: Some(Remote {
            address: "127.0.0.1:0".parse().expect("an address"),
            token: Token::new("a-shared-secret"),
            tls: None,
        }),
    })
    .expect("a remote listener with a token is admitted");
    let serving = Serving::bind(Shared::new(server(seeded()), shutdown.clone()), &admitted)
        .await
        .expect("the port binds");
    let address = serving.remote_address().expect("the port it actually got");
    let accepting = tokio::spawn(serving.run());
    let mut over_socket = remote_raw(address).await;

    let refusals = futures_util::future::join(
        refusal_to(&mut over_pipe, MALFORMED),
        refusal_to(&mut over_socket, MALFORMED),
    )
    .await;

    assert_eq!(
        refusals.0, refusals.1,
        "the code that refuses a frame is the same code, so the refusal has to be the same refusal"
    );
    let (code, params, id) = refusals.0;
    assert_eq!(code, DiagnosticCode::RequestInvalid);
    assert_eq!(
        params.get("field").and_then(serde_json::Value::as_str),
        Some("command"),
        "naming what could not be read"
    );
    assert_eq!(
        id, "7",
        "and echoing the client's own id, so one bad call fails instead of the session"
    );

    shutdown.cancel();
    accepting.await.expect("a graceful shutdown");
}

/// Put a raw frame on the wire and read back the refusal it earns.
async fn refusal_to<S>(
    client: &mut TestClient<S>,
    frame: &str,
) -> (
    DiagnosticCode,
    serde_json::Map<String, serde_json::Value>,
    String,
)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    client.send_raw(Message::text(frame.to_string())).await;
    loop {
        let cdc_server::protocol::Outbound::Answer(response) = client.next().await else {
            continue;
        };
        let Outcome::Err { diagnostic } = response.outcome else {
            panic!("a frame that is not a request is refused, not carried out");
        };
        return (diagnostic.code, diagnostic.params, response.id);
    }
}

/// A raw client on the remote listener, presenting the token the listener was given.
async fn remote_raw(address: std::net::SocketAddr) -> TestClient<tokio::net::TcpStream> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("the port is being served");
    let mut request = format!("ws://{address}/")
        .into_client_request()
        .expect("a client request");
    request.headers_mut().insert(
        "authorization",
        "Bearer a-shared-secret".parse().expect("a header value"),
    );
    let (socket, _) = tokio_tungstenite::client_async(request, stream)
        .await
        .expect("the token is the one the listener was given");
    TestClient::new(socket)
}
