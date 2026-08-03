//! The network adapter — the one resource whose two surfaces answer genuinely different shapes.

use cdc_runtime::adapters::base_urls::LIBPOD_PATH_PREFIX;
use cdc_runtime::adapters::networks::{self, CreateNetwork};
use cdc_runtime::adapters::shared::AdapterError;
use cdc_runtime::domain::types::engine::ApiSurface;
use serde_json::Value;

use super::{asked, only, routed, serving};

/// Real `GET http://d/v4.0.0/libpod/networks/json` — already the canonical shape.
const LIBPOD: &str = r#"[{
  "name": "podman", "id": "2f259bab93aa", "driver": "bridge", "network_interface": "podman0",
  "created": "2026-08-03T09:49:04.415864868+02:00",
  "subnets": [{"subnet": "10.88.0.0/16", "gateway": "10.88.0.1"}],
  "ipv6_enabled": false, "internal": false, "dns_enabled": false,
  "ipam_options": {"driver": "host-local"}
}]"#;

/// Real `GET http://localhost/networks` on Docker 29.7.0 — PascalCase, and `IPAM.Options` is `null`.
const DOCKER: &str = r#"[{
  "Name": "bridge", "Id": "81d37b4de866", "Created": "2026-07-31T10:04:30.931510453+02:00",
  "Driver": "bridge", "EnableIPv6": false, "Internal": false, "Labels": {},
  "IPAM": {"Driver": "default", "Options": null, "Config": [{"Subnet": "172.17.0.0/16", "Gateway": "172.17.0.1"}]},
  "Options": {"com.docker.network.bridge.name": "docker0"}
}]"#;

#[tokio::test]
async fn a_real_libpod_row_is_already_canonical() {
    let (api, log) = serving(ApiSurface::Libpod, LIBPOD);

    let networks = networks::list(&api).await.expect("the list");

    assert_eq!(
        only(&log).path,
        format!("{LIBPOD_PATH_PREFIX}/networks/json")
    );
    assert_eq!(networks[0].name, "podman");
    assert_eq!(networks[0].subnets[0].subnet, "10.88.0.0/16");
    assert_eq!(networks[0].ipam_options["driver"], "host-local");
}

#[tokio::test]
async fn a_real_docker_row_is_mapped_onto_the_same_shape_from_a_different_path() {
    let (api, log) = serving(ApiSurface::Docker, DOCKER);

    let networks = networks::list(&api).await.expect("the list");

    assert_eq!(only(&log).path, "/networks", "no `/json`, and no prefix");
    assert_eq!(networks[0].name, "bridge");
    assert_eq!(
        networks[0].subnets[0].subnet, "172.17.0.0/16",
        "Docker carries subnets under IPAM.Config"
    );
    assert_eq!(networks[0].subnets[0].gateway, "172.17.0.1");
}

#[tokio::test]
async fn a_row_that_will_not_map_onto_the_canonical_shape_names_the_path_it_came_from() {
    // A `Name` that is not a string. `IPAM` would NOT do it — that field is a `Value` on purpose,
    // because Docker's normalizer puts the whole object there.
    let (api, _) = serving(ApiSurface::Docker, r#"[{"Name": 7}]"#);

    let error = networks::list(&api).await.expect_err("unreadable");

    let AdapterError::Malformed { path, .. } = error else {
        panic!("expected malformed, got {error:?}");
    };
    assert_eq!(path, "/networks");
}

#[tokio::test]
async fn a_single_get_takes_a_different_path_on_each_surface() {
    let (docker, docker_log) = serving(ApiSurface::Docker, "{}");
    networks::get(&docker, "bridge").await.expect("the network");
    assert_eq!(only(&docker_log).path, "/networks/bridge");

    let (podman, podman_log) = serving(ApiSurface::Libpod, "{}");
    networks::get(&podman, "podman").await.expect("the network");
    assert_eq!(
        only(&podman_log).path,
        format!("{LIBPOD_PATH_PREFIX}/networks/podman/json")
    );
}

#[tokio::test]
async fn a_docker_create_reads_the_network_back_because_it_only_answers_an_id() {
    let (api, log) = routed(
        ApiSurface::Docker,
        &[
            ("/networks/create", 201, r#"{"Id":"new-id","Warning":""}"#),
            ("/networks/new-id", 200, r#"{"Name":"mine","Id":"new-id"}"#),
        ],
    );
    let opts = CreateNetwork {
        name: "mine".to_string(),
        driver: "bridge".to_string(),
        internal: true,
        ipv6_enabled: true,
    };

    let network = networks::create(&api, &opts).await.expect("created");

    assert_eq!(network.name, "mine");
    let requests = asked(&log);
    assert_eq!(
        requests[1].path, "/networks/new-id",
        "read back, and normalized on the way"
    );
    let body: Value =
        serde_json::from_str(requests[0].body.as_deref().expect("a body")).expect("json");
    assert_eq!(
        body,
        serde_json::json!({
            "Name": "mine", "Driver": "bridge", "Internal": true, "EnableIPv6": true
        }),
        "Docker's own spellings, `EnableIPv6` among them"
    );
}

#[tokio::test]
async fn a_libpod_create_answers_the_network_itself_in_one_request() {
    let (api, log) = serving(
        ApiSurface::Libpod,
        r#"{"name":"mine","id":"new-id","subnets":null}"#,
    );
    let opts = CreateNetwork {
        name: "mine".to_string(),
        driver: "bridge".to_string(),
        internal: false,
        ipv6_enabled: false,
    };

    let network = networks::create(&api, &opts).await.expect("created");

    assert_eq!(network.name, "mine");
    assert!(
        network.subnets.is_empty(),
        "`subnets: null` is the empty list"
    );
    let request = only(&log);
    assert_eq!(
        request.path,
        format!("{LIBPOD_PATH_PREFIX}/networks/create")
    );
    let body: Value = serde_json::from_str(request.body.as_deref().expect("a body")).expect("json");
    assert_eq!(body["ipv6_enabled"], false, "libpod's canonical spellings");
}

#[tokio::test]
async fn a_remove_is_the_same_call_on_both_surfaces_but_for_the_root() {
    let (api, log) = serving(ApiSurface::Libpod, "null");

    networks::remove(&api, "mine").await.expect("removed");

    let request = only(&log);
    assert_eq!(request.method, "DELETE");
    assert_eq!(request.path, format!("{LIBPOD_PATH_PREFIX}/networks/mine"));
}
