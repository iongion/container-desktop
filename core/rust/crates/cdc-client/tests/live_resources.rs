#![cfg(feature = "live-resources")]
//! A client reading real resources off the real engine on this machine. NOT part of `cargo test`.
//!
//! `cargo test -p cdc-client --features live-resources --test live_resources -- --nocapture`
//!
//! **This is the whole composition, and nothing hermetic can stand in for it.** The suite next door
//! proves the mux against an embedded server whose engine is a fake, and `live_adapters` proves the
//! adapters against a real engine in the SAME process as the transport. What neither can see is the one
//! path a desktop client actually takes: adapters over a forwarded `Http`, a mux, a WebSocket, a server,
//! a machine, and a real `podman system service` at the end of it. Every defect this port has shipped
//! was in a seam like that.
//!
//! **It writes nothing of the user's.** The document is in a temporary directory, exactly as
//! `live_server`'s is.

use std::sync::Arc;

use cdc_client::embedded;
use cdc_client::mux::Mux;
use cdc_runtime::adapters::{containers, images, volumes};
use cdc_runtime::command_proxy::Forwarder;
use cdc_runtime::domain::types::engine::ApiSurface;
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectOrigin, ConnectionPhase};
use cdc_server::host;
use cdc_server::listen::session::Shared;
use cdc_server::protocol::{Command, Reply};
use tokio_util::sync::CancellationToken;

const CONNECTION: &str = "host.live.podman.native";

/// The image the streaming half uses. It must already be local — this suite never pulls.
const IMAGE: &str = "docker.io/library/httpd:latest";

const THROWAWAY: &str = "cdc-live-resources";

/// One podman native connection, as `connection.ts` seeds it.
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
    .expect("the document serializes")
}

#[tokio::test]
async fn a_client_reads_the_real_engines_resources_through_the_server_that_owns_its_transport() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let settings = directory.path().join("user-settings.json");
    std::fs::write(&settings, document()).expect("the document is written");

    let shutdown = CancellationToken::new();
    let shared = Shared::new(
        host::server_at(&settings, &host::app_version()),
        shutdown.clone(),
    );
    let client = embedded::attach(Arc::clone(&shared))
        .await
        .expect("a server in this process is always reachable");
    let (mux, mut frames) = Mux::spawn(client);
    let mux = Arc::new(mux);
    // The arrival snapshot, off the channel rather than off the socket.
    let _ = frames.recv().await;

    let Reply::Snapshot { snapshot } = ({
        let asked = mux
            .ask(Command::Connect {
                connection_id: CONNECTION.to_string(),
                origin: ConnectOrigin::User,
            })
            .await;
        match asked {
            cdc_client::mux::Answer::Replied(reply) => reply,
            // A connect never answers with a stream; naming the arm is what keeps this compiling when
            // another one is added.
            cdc_client::mux::Answer::Streamed(_) => panic!("a connect is not a forwarded stream"),
            cdc_client::mux::Answer::Refused(diagnostic) => {
                println!("SKIP: the server refused to connect: {diagnostic:?}");
                return;
            }
            cdc_client::mux::Answer::Gone => {
                println!("SKIP: the session went away");
                return;
            }
        }
    }) else {
        panic!("a connect answers with the snapshot it produced");
    };
    let phase = snapshot
        .active
        .as_ref()
        .and_then(|active| active.iter().find(|it| it.id == CONNECTION))
        .map(|it| it.phase);
    if phase != Some(ConnectionPhase::Ready) {
        println!("SKIP: podman did not come up: {phase:?}");
        return;
    }

    // The surface a client would read off `ConnectionSummary`, asserted rather than assumed: an adapter
    // that took the wrong root would ask the wrong engine's routes.
    let summary = snapshot
        .connections
        .iter()
        .find(|it| it.id == CONNECTION)
        .expect("the connection is listed");
    assert_eq!(
        summary.api_surface,
        Some(ApiSurface::Libpod),
        "podman's own REST vocabulary, computed by the server and carried on the projection"
    );

    let api = cdc_runtime::adapters::shared::EngineApi::new(
        Arc::new(cdc_runtime::command_proxy::ForwardedHttp::new(
            Arc::clone(&mux) as Arc<dyn Forwarder>,
        )),
        cdc_runtime::capabilities::http::Endpoint::Connection(CONNECTION.to_string()),
        // Empty, deliberately: the machine on the far side adds `Host`, `Accept`, `Content-Type` and
        // `User-Agent` from the connection it resolved. A green read here is what proves that.
        Vec::new(),
        summary.api_surface.expect("a registered connector"),
    );

    let found = containers::list(&api)
        .await
        .expect("the container list, read whole through the protocol");
    println!("containers: {}", found.len());
    for container in &found {
        assert!(!container.id.is_empty());
        assert!(
            !container.computed.decoded_state.is_empty(),
            "every row is normalized on the way through: {container:?}"
        );
    }

    let images = images::list(&api).await.expect("the image list");
    println!("images: {}", images.len());
    for image in &images {
        assert!(!image.registry.is_empty(), "a registry is always computed");
    }

    println!(
        "volumes: {}",
        volumes::list(&api).await.expect("volumes").len()
    );

    // **The write side and the streaming side, end to end through the forwarding protocol.** A whole
    // response cannot exercise either: a create is a POST with a body, and a log body arrives as pushes
    // the mux has to route to this reader and to nothing else. The streaming half was broken here in a
    // way nothing hermetic saw — the reply came back refused, because its channel's receiver was
    // discarded as the handle was registered.
    if images.iter().any(|image| {
        image
            .names
            .as_deref()
            .is_some_and(|names| names.iter().any(|it| it == IMAGE))
    }) {
        // A leftover from a run that died mid-test would make the create fail on the name.
        let _ = containers::remove(&api, THROWAWAY).await;
        let created = containers::create(
            &api,
            &containers::CreateContainer {
                image_id: IMAGE.to_string(),
                name: Some(THROWAWAY.to_string()),
                start: true,
                ..containers::CreateContainer::default()
            },
        )
        .await
        .expect("a container is created and started through the forwarded api");
        println!("created {} started={}", created.id, created.started);

        let log = containers::logs(&api, &created.id, &containers::LogsOptions::default())
            .await
            .expect("a log body, byte for byte");
        println!("log: {} bytes", log.len());
        assert!(!log.is_empty(), "httpd writes to stderr on start");
        assert!(
            log.iter().any(|byte| *byte >= 0x80) || log[..4] == [0x02, 0x00, 0x00, 0x00],
            "the frame header survives the whole carriage undecoded: {:x?}",
            &log[..log.len().min(16)]
        );

        containers::stop(&api, &created.id).await.expect("the stop");
        containers::remove(&api, &created.id)
            .await
            .expect("the remove");
        assert!(
            containers::get(&api, &created.id).await.is_err(),
            "it is gone, and a refusal carried through the protocol is what says so"
        );
    } else {
        println!("SKIP: {IMAGE} is not local and this suite never pulls");
    }

    mux.ask(Command::Disconnect {
        connection_id: CONNECTION.to_string(),
    })
    .await;
    shared.clients.cancel_all();
    shared.tasks.close();
    shared.tasks.wait().await;
    shared.stop_connections().await;
    shutdown.cancel();
}
