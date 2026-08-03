#![cfg(feature = "live-server")]
//! The whole server against the real engine on this machine. NOT part of the default `cargo test`.
//!
//! `cargo test -p cdc-server --features live-server --test live_server -- --nocapture`
//!
//! **This is the server's exit criterion, and nothing hermetic can stand in for it.** The suite
//! next door proves the protocol against fakes: a session that answers, a queue that bounds, a token
//! that refuses. What it cannot see is a server that does all of that correctly and never brings up
//! an engine — and the one defect in this port that no fake could have found (a chunked `/_ping`
//! body) was exactly that shape. So: the real binary's composition, the real `podman` on this
//! a real client.
//!
//! **It writes nothing of the user's.** `host::server_at` names a document in a temporary directory,
//! which is the whole of what `native_server` would have read from the environment. A live test that
//! edited `~/.config/container-desktop/user-settings.json` would be a live test nobody dares run
//! twice.
//!
//! One test rather than several, deliberately: it starts an engine API service, and the sequence —
//! attach, connect, forward, stream, shut down — is one story about one connection.

use std::sync::Arc;

use cdc_runtime::domain::types::command_proxy_protocol::CommandProxyResult;
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectOrigin, ConnectionPhase};
use cdc_server::host;
use cdc_server::listen::endpoint::Serving;
use cdc_server::listen::session::Shared;
use cdc_server::listen::{Admitted, Listen};
use cdc_server::protocol::{Command, Event, Outbound, Reply, Request};
use tokio_util::sync::CancellationToken;

#[path = "../../cdc-runtime/tests/fakes/mod.rs"]
mod fakes;
#[path = "harness/mod.rs"]
mod harness;

use crate::harness::{PATIENCE, replied};

const CONNECTION: &str = "host.live.podman.native";

/// The document the server will read: one podman native connection, as `connection.ts` seeds it.
fn document() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
      "version": "5.2.19",
      "connections": [{
        "id": CONNECTION,
        "name": "live",
        "label": "Live",
        "engine": "podman",
        "host": "podman.native",
        "settings": {
          "api": { "baseURL": "http://d", "connection": { "uri": "", "relay": "" } },
          "program": { "name": "podman", "path": "", "version": "" },
          "rootfull": false,
          "mode": "mode.automatic"
        }
      }]
    }))
    .expect("the fixture serializes")
}

#[tokio::test]
async fn the_server_brings_up_the_real_engine_and_forwards_to_it() {
    // The server's own log, because a hang here is a question about what it was doing and the DOM of a
    // socket is a log line.
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_test_writer()
        .try_init();
    let directory = harness::short_tempdir();
    let settings = directory.path().join("user-settings.json");
    std::fs::write(&settings, document()).expect("the document is written");
    let socket = directory.path().join("s.sock");

    let shutdown = CancellationToken::new();
    let shared = Shared::new(host::server_at(&settings, "5.2.19"), shutdown.clone());
    let serving = Serving::bind(
        Arc::clone(&shared),
        &Admitted::admit(Listen {
            local: Some(socket.clone()),
            remote: None,
        })
        .expect("a local socket is admitted"),
    )
    .await
    .expect("the socket binds");
    let accepting = tokio::spawn(serving.run());

    // Room for the real thing: `NativeTransport` polls for the engine's socket up to
    // API_READINESS_ATTEMPTS times, and `podman system info` alone takes about a second on this machine.
    let mut client = harness::local_client(&socket)
        .await
        .with_patience(std::time::Duration::from_secs(90));

    // 1. The state, before it asks for anything.
    let Outbound::Pushed(first) = client.next().await else {
        panic!("a client is handed the state on arrival");
    };
    let Event::Snapshot { snapshot } = first.event else {
        panic!("and that state is a snapshot");
    };
    assert_eq!(
        snapshot.connections.len(),
        1,
        "the document this server was pointed at: {snapshot:?}"
    );

    // 2. The real connection, brought up for real: `podman system service` if it is not already there.
    client
        .send(&Request::new(
            "connect",
            Command::Connect {
                connection_id: CONNECTION.to_string(),
                origin: ConnectOrigin::User,
            },
        ))
        .await;
    let Reply::Snapshot { snapshot } = replied(client.reply_to("connect").await) else {
        panic!("a connect answers with the state it produced");
    };
    let active = snapshot
        .active
        .as_ref()
        .expect("a connection was attempted");
    let podman = active.first().expect("exactly the one");
    assert_eq!(
        podman.phase,
        ConnectionPhase::Ready,
        "the engine on this machine must actually answer: {podman:?}"
    );
    println!(
        "connected: uri={:?} version={:?}",
        podman.uri, podman.version
    );

    // 3. A forwarded request, which is the whole point of a connection: the client's HTTP arrives at the
    //    engine through the connection that owns the transport.
    client
        .send(&Request::new(
            "ping",
            harness::proxy(
                Some(CONNECTION),
                serde_json::json!({ "url": "/_ping", "method": "GET" }),
            ),
        ))
        .await;
    let Reply::Proxied { result } = replied(client.reply_to("ping").await) else {
        panic!("expected a forwarded answer");
    };
    let CommandProxyResult::Buffered(response) = *result else {
        panic!("a plain GET is not a stream");
    };
    assert_eq!(
        response.status,
        Some(200),
        "the engine answered: {response:?}"
    );
    println!("/_ping answered {:?} {:?}", response.status, response.data);

    // 4. A STREAMED request, opened and then torn down. `/events` says nothing until something happens on
    //    the machine, which is exactly why this asserts the handle and the teardown rather than a chunk:
    //    a stream is never given a deadline, so waiting for one here would be waiting forever.
    client
        .send(&Request::new(
            "events",
            harness::proxy(
                Some(CONNECTION),
                serde_json::json!({ "url": "/events", "responseType": "stream" }),
            ),
        ))
        .await;
    let Reply::Proxied { result } = replied(client.reply_to("events").await) else {
        panic!("expected a forwarded answer");
    };
    let CommandProxyResult::Stream(handle) = *result else {
        panic!("a streamed request answers with a handle");
    };
    assert!(shared.streams.is_open(&handle.stream_id));
    client
        .send(&Request::new(
            "destroy",
            Command::DestroyStream {
                stream_id: handle.stream_id.clone(),
            },
        ))
        .await;
    assert!(matches!(
        replied(client.reply_to("destroy").await),
        Reply::Destroyed
    ));
    assert!(
        !shared.streams.is_open(&handle.stream_id),
        "the engine connection it was holding is let go of"
    );

    // 5. The shutdown, which is what kills whatever the connect started.
    shutdown.cancel();
    tokio::time::timeout(PATIENCE, accepting)
        .await
        .expect("a graceful shutdown is not a hang")
        .expect("without panicking");
    let after = shared
        .server
        .snapshot()
        .expect("the document is still readable");
    assert!(
        after.active.is_none(),
        "every connection is down afterwards: {after:?}"
    );
    assert!(!socket.exists(), "and the socket file is gone");
}
