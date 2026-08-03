//! The resource adapters against the real engines on this machine. NOT part of `cargo test`.
//!
//! `cargo test -p cdc-runtime-host-native --features live-adapters --test live_adapters -- --nocapture --test-threads=1`
//!
//! What the hermetic suite cannot see: a shape that parses against a captured fixture and refuses
//! against the engine two versions later. Every list here is read from a live daemon, and the podman
//! half also creates, starts, reads the logs of, stops and removes one throwaway container — the only
//! way to prove the write side composes a request an engine accepts.
//!
//! Each test SKIPS rather than fails when its engine is absent.

#![cfg(feature = "live-adapters")]

use std::sync::Arc;

use cdc_runtime::adapters::shared::EngineApi;
use cdc_runtime::adapters::{containers, images, networks, pods, secrets, system_df, volumes};
use cdc_runtime::capabilities::http::{Endpoint, HttpRequest};
use cdc_runtime::domain::machine::{
    ConnectionCapabilities, ConnectionContext, ConnectionMachine, proxy,
};
use cdc_runtime::domain::types::connection::{ConnectOptions, Connection};
use cdc_runtime::domain::types::engine::ApiSurface;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectOrigin, ConnectionPhase};
use cdc_runtime::runtimes::dialects::shared::normalize_unix_socket_path;
use cdc_runtime::runtimes::transports::shared::api_endpoint;
use cdc_runtime_host_native::command::TokioCommand;
use cdc_runtime_host_native::fs::{StdFs, SystemClock};
use cdc_runtime_host_native::http::TokioHttp;
use serde_json::json;

/// Docker's socket, and the only address in this suite that is not resolved by a connection.
const DOCKER_SOCKET: &str = "/var/run/docker.sock";

/// The image the lifecycle test uses. It must already be local — this suite never pulls.
const IMAGE: &str = "docker.io/library/httpd:latest";

const THROWAWAY: &str = "cdc-live-adapters";

fn podman_native() -> Connection {
    serde_json::from_value(json!({
      "id": "host.live.podman.native",
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
    }))
    .expect("connection fixture parses")
}

/// A real podman connection, brought up for real — `podman system service` and all.
///
/// The address and the headers come from the SAME two resolvers a production caller would use, so a
/// green run here is evidence about the composition and not only about the adapters.
async fn podman() -> Option<(ConnectionMachine, EngineApi)> {
    let mut machine = ConnectionMachine::new(
        ConnectOptions {
            connection: podman_native(),
            start_api: true,
            skip_availability_check: false,
            origin: None,
        },
        ConnectionContext {
            os: OperatingSystem::Linux,
            app_version: "5.2.19".to_string(),
            ..ConnectionContext::default()
        },
        ConnectionCapabilities {
            command: Arc::new(TokioCommand::default()),
            fs: Arc::new(StdFs),
            http: Arc::new(TokioHttp),
            clock: Arc::new(SystemClock),
        },
    );
    machine.connect(ConnectOrigin::Bootstrap, None).await;
    if machine.phase() != ConnectionPhase::Ready {
        println!(
            "SKIP: podman did not come up: {:?}",
            machine.runtime_info().error
        );
        return None;
    }
    let settings = machine.settings().clone();
    let endpoint = api_endpoint(&normalize_unix_socket_path(&settings.api.connection.uri));
    println!("podman at {endpoint:?}");
    let api = EngineApi::new(
        Arc::new(TokioHttp),
        endpoint,
        proxy::api_headers(&settings.api, "5.2.19"),
        ApiSurface::Libpod,
    );
    Some((machine, api))
}

/// Docker, if its socket answers. Reached directly: this suite has no docker CONNECTION to resolve
/// and the point here is the surface seam, not detection.
async fn docker() -> Option<EngineApi> {
    let endpoint = Endpoint::UnixSocket(DOCKER_SOCKET.to_string());
    let ping = HttpRequest::ping(endpoint.clone());
    let http = TokioHttp;
    match cdc_runtime::capabilities::http::Http::request(&http, &ping).await {
        Ok(response) if response.ok() => {}
        other => {
            println!("SKIP: {DOCKER_SOCKET} is not answering: {other:?}");
            return None;
        }
    }
    let settings = json!({ "baseURL": "http://localhost", "connection": { "uri": DOCKER_SOCKET, "relay": "" } });
    let api_settings = serde_json::from_value(settings).expect("api settings");
    Some(EngineApi::new(
        Arc::new(TokioHttp),
        endpoint,
        proxy::api_headers(&api_settings, "5.2.19"),
        ApiSurface::Docker,
    ))
}

#[tokio::test]
async fn every_libpod_list_reads_whole_against_the_real_podman() {
    let Some((mut machine, api)) = podman().await else {
        return;
    };

    // The compat route, and the one that used to come back empty: real podman answers `Config: null`
    // there, which a struct without `null_default` refuses for the WHOLE list.
    let found = containers::list(&api).await.expect("the container list");
    println!("containers: {}", found.len());
    for container in &found {
        assert!(!container.id.is_empty());
        assert!(
            !container.computed.decoded_state.is_empty(),
            "every row is normalized: {container:?}"
        );
        assert!(
            !container
                .computed
                .name
                .as_deref()
                .unwrap_or("/")
                .starts_with('/'),
            "the compat route slashes its names and the normalizer strips them"
        );
    }

    let images = images::list(&api).await.expect("the image list");
    println!("images: {}", images.len());
    for image in &images {
        assert!(!image.id.is_empty());
        assert!(!image.registry.is_empty(), "a registry is always computed");
    }

    println!(
        "volumes: {}",
        volumes::list(&api).await.expect("volumes").len()
    );
    println!(
        "networks: {}",
        networks::list(&api).await.expect("networks").len()
    );
    println!(
        "secrets: {}",
        secrets::list(&api).await.expect("secrets").len()
    );
    println!("pods: {}", pods::list(&api).await.expect("pods").len());

    let usage = system_df::get(&api).await.expect("system df");
    println!("system df: {usage:?}");
    assert!(
        usage.images_size > 0,
        "an engine with images reports a size"
    );
    assert!(usage.images_count >= images.len() as i64 - 1, "{usage:?}");

    machine.disconnect().await;
}

#[tokio::test]
async fn a_container_can_be_created_started_read_and_removed_through_the_adapters() {
    let Some((mut machine, api)) = podman().await else {
        return;
    };
    if !images::list(&api)
        .await
        .expect("the image list")
        .iter()
        .any(|image| {
            image
                .names
                .as_deref()
                .is_some_and(|names| names.iter().any(|it| it == IMAGE))
        })
    {
        println!("SKIP: {IMAGE} is not local and this suite never pulls");
        machine.disconnect().await;
        return;
    }
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
    .expect("the container is created");
    println!("created {} started={}", created.id, created.started);
    assert!(created.started);

    let inspected = containers::get(&api, &created.id)
        .await
        .expect("the inspect");
    assert!(inspected.is_running(), "{:?}", inspected.state);

    let log = containers::logs(&api, &created.id, &containers::LogsOptions::default())
        .await
        .expect("the log");
    println!("log: {} bytes", log.len());
    assert!(!log.is_empty(), "httpd writes to stderr on start");
    assert!(
        log.iter().any(|byte| *byte >= 0x80) || log[..4] == [0x02, 0x00, 0x00, 0x00],
        "the log arrives multiplexed and undecoded: {:x?}",
        &log[..log.len().min(16)]
    );

    let sample = containers::stats(&api, &created.id)
        .await
        .expect("the stats");
    assert_eq!(sample.name, THROWAWAY, "the wire spells these lowercase");

    let report = containers::processes(&api, &created.id).await.expect("top");
    println!(
        "top: {} titles, {} rows",
        report.titles.len(),
        report.processes.len()
    );
    assert!(!report.titles.is_empty());
    for row in &report.processes {
        assert_eq!(
            row.len(),
            report.titles.len(),
            "one cell per title, whether the engine sent them that way or they were rejoined"
        );
    }

    containers::stop(&api, &created.id).await.expect("the stop");
    containers::remove(&api, &created.id)
        .await
        .expect("the remove");
    assert!(
        containers::get(&api, &created.id).await.is_err(),
        "it is gone, and a refusal is what says so"
    );

    machine.disconnect().await;
}

#[tokio::test]
async fn every_docker_list_reads_whole_against_the_real_docker() {
    let Some(api) = docker().await else {
        return;
    };

    let found = containers::list(&api).await.expect("the container list");
    println!("containers: {}", found.len());
    for container in &found {
        assert!(
            !container.computed.decoded_state.is_empty(),
            "{container:?}"
        );
    }

    let images = images::list(&api).await.expect("the image list");
    println!("images: {}", images.len());

    // The envelope: Docker wraps its volume list where libpod answers a bare array.
    let volumes = volumes::list(&api).await.expect("volumes");
    println!("volumes: {}", volumes.len());
    for volume in &volumes {
        assert!(!volume.name.is_empty());
    }

    let networks = networks::list(&api).await.expect("networks");
    println!("networks: {}", networks.len());
    assert!(
        networks.iter().any(|it| it.name == "bridge"),
        "every docker has a bridge, and reading it proves the PascalCase mapping ran"
    );

    let usage = system_df::get(&api).await.expect("system df");
    println!("system df: {usage:?}");
    assert!(usage.images_count >= images.len() as i64 - 1, "{usage:?}");

    // A node that is not a swarm manager REFUSES this, with its own sentence. Either answer is
    // correct; an empty list with no reason is what the original gives and what this must not.
    match secrets::list(&api).await {
        Ok(found) => println!("secrets: {}", found.len()),
        Err(error) => println!("secrets refused, with a reason: {error}"),
    }
}
