//! The swarm adapter against a REAL Docker Swarm. NOT part of `cargo test`.
//!
//! ```sh
//! support/swarm-sandbox.sh up          # a dind daemon, NOT yet in a swarm
//! cargo test -p cdc-runtime-host-native --features live-swarm --test live_swarm -- --nocapture --test-threads=1
//! support/swarm-sandbox.sh down
//! ```
//!
//! **Against a throwaway `docker:dind`, never the primary daemon** — this suite runs `swarm init` and
//! `swarm leave`, which would rewrite a real cluster's identity. The socket is the sandbox's bind mount;
//! point somewhere else with `CDC_LIVE_SWARM_SOCKET`.
//!
//! What the hermetic fixtures cannot see: whether Docker spells the fields `types/swarm.rs` reads. Those
//! fixtures were shaped from documentation rather than captured, so this is the suite that decides
//! whether the model is right — the resource model was built from REAL captures and still shipped a
//! defect, and this one had less to go on.
//!
//! It skips honestly and says why.

#![cfg(feature = "live-swarm")]

use std::sync::Arc;

use cdc_runtime::adapters::shared::EngineApi;
use cdc_runtime::adapters::swarm;
use cdc_runtime::capabilities::http::{Endpoint, Http, HttpRequest};
use cdc_runtime::domain::machine::proxy;
use cdc_runtime::domain::types::engine::ApiSurface;
use cdc_runtime::domain::types::swarm::{
    NodeUpdateOptions, SwarmInitOptions, SwarmLeaveOptions, SwarmNodeAvailability,
    SwarmSecretCreateOptions,
};
use cdc_runtime_host_native::http::TokioHttp;
use serde_json::json;

/// The sandbox's bind-mounted socket, relative to the repository root.
const DEFAULT_SOCKET: &str = "temp/swarm-sandbox/docker.sock";

/// Named so a failed run leaves something recognisable rather than a mystery.
const SERVICE: &str = "cdc-live-swarm";
const SECRET: &str = "cdc-live-swarm-secret";

/// An image the dind daemon already has, or can get quickly. `swarm` needs one that stays up.
const IMAGE: &str = "docker.io/library/httpd:alpine";

fn socket() -> String {
    std::env::var("CDC_LIVE_SWARM_SOCKET").unwrap_or_else(|_| {
        // The suite runs from the crate directory; the sandbox writes under the repository root.
        format!("{}/../../../{DEFAULT_SOCKET}", env!("CARGO_MANIFEST_DIR"))
    })
}

/// The sandbox daemon, if it is answering.
async fn sandbox() -> Option<EngineApi> {
    let path = socket();
    let endpoint = Endpoint::UnixSocket(path.clone());
    match Http::request(&TokioHttp, &HttpRequest::ping(endpoint.clone())).await {
        Ok(response) if response.ok() => {}
        other => {
            println!(
                "SKIP: {path} is not answering ({other:?}) — `support/swarm-sandbox.sh up` first"
            );
            return None;
        }
    }
    let settings =
        json!({ "baseURL": "http://localhost", "connection": { "uri": path, "relay": "" } });
    Some(EngineApi::new(
        Arc::new(TokioHttp),
        endpoint,
        proxy::api_headers(
            &serde_json::from_value(settings).expect("api settings"),
            "5.2.19",
        ),
        ApiSurface::Docker,
    ))
}

/// Leave any cluster the last run left behind, so `init` is always the first thing this does.
async fn leave_quietly(api: &EngineApi) {
    let _ = swarm::leave(api, &SwarmLeaveOptions { force: Some(true) }).await;
}

#[tokio::test]
async fn a_daemon_that_is_not_a_swarm_manager_answers_503_and_this_reads_it_as_nothing() {
    let Some(api) = sandbox().await else {
        return;
    };
    leave_quietly(&api).await;

    // THE rule this port drops three substring fallbacks on: the status has to arrive as a number.
    let services = swarm::list_services(&api)
        .await
        .expect("empty, not an error");
    let nodes = swarm::list_nodes(&api).await.expect("empty, not an error");
    let info = swarm::inspect(&api).await.expect("nothing, not an error");

    assert!(services.is_empty(), "got {services:?}");
    assert!(nodes.is_empty(), "got {nodes:?}");
    assert!(info.is_none(), "got {info:?}");
    println!("OK: a non-manager daemon reads as empty through a typed 503");
}

#[tokio::test]
async fn a_cluster_is_initialised_read_whole_and_left() {
    let Some(api) = sandbox().await else {
        return;
    };
    leave_quietly(&api).await;

    swarm::init(&api, &SwarmInitOptions::default())
        .await
        .expect("the sandbox daemon initialises a single-node swarm");

    let info = swarm::inspect(&api)
        .await
        .expect("an inspect")
        .expect("a manager answers one");
    assert!(
        !info.id.is_empty(),
        "the cluster id is what every write echoes against"
    );
    assert!(
        !info.join_tokens.manager.is_empty() && !info.join_tokens.worker.is_empty(),
        "the join tokens are what another node needs, and a wrong spelling reads as empty: {info:?}"
    );
    assert!(
        info.version.index > 0,
        "Version.Index: {}",
        info.version.index
    );

    let nodes = swarm::list_nodes(&api).await.expect("the nodes");
    assert_eq!(nodes.len(), 1, "a single-node swarm: {nodes:?}");
    let node = &nodes[0];
    assert!(
        !node.description.hostname.is_empty(),
        "Description.Hostname: {node:?}"
    );
    assert!(
        node.manager_status.leader,
        "the only node in a swarm it just created is its leader: {:?}",
        node.manager_status
    );
    assert_eq!(
        node.status.state, "ready",
        "Status.State: {:?}",
        node.status
    );
    println!(
        "OK: cluster {} read whole, {} node(s)",
        info.id,
        nodes.len()
    );

    swarm::leave(&api, &SwarmLeaveOptions { force: Some(true) })
        .await
        .expect("and it leaves");
    assert!(
        swarm::inspect(&api).await.expect("nothing").is_none(),
        "after leaving, the daemon is not a manager again"
    );
}

#[tokio::test]
async fn a_service_is_created_scaled_derived_into_a_stack_and_removed() {
    let Some(api) = sandbox().await else {
        return;
    };
    leave_quietly(&api).await;
    swarm::init(&api, &SwarmInitOptions::default())
        .await
        .expect("a swarm to put a service in");

    // The stack label is what `list_stacks` derives from — there is no REST object to ask.
    let spec = json!({
        "Name": SERVICE,
        "Labels": { "com.docker.stack.namespace": "cdc-live" },
        "TaskTemplate": { "ContainerSpec": { "Image": IMAGE } },
        "Mode": { "Replicated": { "Replicas": 1 } }
    });
    swarm::create_service(&api, &spec)
        .await
        .expect("the create body is one Docker accepts");

    let services = swarm::list_services(&api).await.expect("the services");
    let created = services
        .iter()
        .find(|it| it.spec.name == SERVICE)
        .expect("the service that was just created");
    assert_eq!(
        created
            .spec
            .task_template
            .container_spec
            .image
            .split('@')
            .next(),
        Some(IMAGE),
        "TaskTemplate.ContainerSpec.Image, as Docker spells it: {:?}",
        created.spec.task_template.container_spec.image
    );
    assert!(
        created.version.index > 0,
        "a write needs this: {:?}",
        created.version
    );

    // The read-modify-write, against a real Version.Index.
    let scaled = swarm::scale_service(&api, &created.id, 2)
        .await
        .expect("the scale is accepted");
    assert!(
        scaled,
        "a service with a Version is written to, not skipped"
    );
    let after = swarm::get_service(&api, &created.id)
        .await
        .expect("a read")
        .expect("still there");
    assert_eq!(
        after.spec.mode.replicated.expect("Replicated").replicas,
        2,
        "the replica count Docker now reports"
    );
    assert!(
        after.version.index > created.version.index,
        "and the version moved, which is what optimistic concurrency means"
    );

    let stacks = swarm::list_stacks(&api).await.expect("the stacks");
    assert!(
        stacks
            .iter()
            .any(|it| it.name == "cdc-live" && it.services >= 1),
        "derived from the label across the service list: {stacks:?}"
    );

    // Cluster secrets are the other write shape: base64 in, and the engine decodes it.
    swarm::create_secret(
        &api,
        &SwarmSecretCreateOptions {
            data: "s3cr3t".to_string(),
            labels: Default::default(),
            name: SECRET.to_string(),
        },
    )
    .await
    .expect("Docker accepts base64 Data and would refuse the raw value");
    let secrets = swarm::list_secrets(&api).await.expect("the secrets");
    let secret = secrets
        .iter()
        .find(|it| it.spec.name == SECRET)
        .expect("the secret just created");
    println!(
        "OK: service scaled to 2, stack derived, secret {} created",
        secret.id
    );

    swarm::remove_secret(&api, &secret.id)
        .await
        .expect("removed");
    swarm::remove_service(&api, &created.id)
        .await
        .expect("removed");
    swarm::leave(&api, &SwarmLeaveOptions { force: Some(true) })
        .await
        .expect("left");
}

#[tokio::test]
async fn a_node_update_carries_the_role_it_was_not_asked_to_change() {
    let Some(api) = sandbox().await else {
        return;
    };
    leave_quietly(&api).await;
    swarm::init(&api, &SwarmInitOptions::default())
        .await
        .expect("a swarm with one manager in it");

    let nodes = swarm::list_nodes(&api).await.expect("the nodes");
    let node = nodes.first().expect("one node").clone();

    // Availability only. If the port dropped the Role fallback, Docker would be asked to demote its own
    // and only manager — which it refuses, so a green run here IS the fallback working.
    let updated = swarm::update_node(
        &api,
        &node.id,
        &NodeUpdateOptions {
            availability: Some(SwarmNodeAvailability::Pause),
            role: None,
        },
    )
    .await
    .expect("the update is accepted");
    assert!(updated, "a node with a Version is written to");

    let after = swarm::get_node(&api, &node.id)
        .await
        .expect("a read")
        .expect("still there");
    assert_eq!(after.spec.availability, Some(SwarmNodeAvailability::Pause));
    assert_eq!(
        after.spec.role, node.spec.role,
        "the role it was not asked about is unchanged: {:?} -> {:?}",
        node.spec.role, after.spec.role
    );
    println!("OK: availability changed to pause, role preserved");

    swarm::leave(&api, &SwarmLeaveOptions { force: Some(true) })
        .await
        .expect("left");
}
