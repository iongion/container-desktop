//! The volume adapter, and the envelope only one of the two surfaces wraps its list in.

use cdc_runtime::adapters::base_urls::LIBPOD_PATH_PREFIX;
use cdc_runtime::adapters::shared::AdapterError;
use cdc_runtime::adapters::volumes::{self, CreateVolume};
use cdc_runtime::domain::types::engine::ApiSurface;
use serde_json::Value;

use super::{only, serving};

/// Real `GET http://localhost/volumes` on Docker 29.7.0 — an envelope, and `Options` is `null`.
const DOCKER_LIST: &str = r#"{"Volumes":[{
  "CreatedAt": "2026-06-16T11:48:54+02:00",
  "Driver": "local",
  "Labels": {"com.docker.volume.anonymous": ""},
  "Mountpoint": "/var/lib/docker/volumes/7489bf/_data",
  "Name": "7489bf",
  "Options": null,
  "Scope": "local"
}], "Warnings": null}"#;

/// Real `GET http://d/v4.0.0/libpod/volumes/json` — a bare array.
const LIBPOD_LIST: &str = r#"[{
  "Name": "bf80f95ed5fb",
  "Driver": "local",
  "Mountpoint": "/home/istoica/.local/share/containers/storage/volumes/bf80f95ed5fb/_data",
  "CreatedAt": "2026-07-06T21:49:51+02:00",
  "Labels": {},
  "Scope": "local",
  "Options": {}
}]"#;

#[tokio::test]
async fn the_docker_list_is_unwrapped_and_its_null_options_do_not_refuse_the_row() {
    let (api, log) = serving(ApiSurface::Docker, DOCKER_LIST);

    let volumes = volumes::list(&api).await.expect("the list");

    assert_eq!(only(&log).path, "/volumes");
    assert_eq!(volumes.len(), 1);
    assert_eq!(volumes[0].name, "7489bf");
    assert!(volumes[0].options.is_empty());
}

#[tokio::test]
async fn the_libpod_list_is_a_bare_array_at_a_different_path() {
    let (api, log) = serving(ApiSurface::Libpod, LIBPOD_LIST);

    let volumes = volumes::list(&api).await.expect("the list");

    assert_eq!(
        only(&log).path,
        format!("{LIBPOD_PATH_PREFIX}/volumes/json")
    );
    assert_eq!(volumes[0].name, "bf80f95ed5fb");
}

#[tokio::test]
async fn a_docker_envelope_with_no_volumes_key_is_an_empty_list_and_not_a_failure() {
    let (api, _) = serving(ApiSurface::Docker, r#"{"Warnings": null}"#);

    let volumes = volumes::list(&api).await.expect("the list");

    assert!(volumes.is_empty());
}

#[tokio::test]
async fn an_envelope_whose_volumes_key_is_not_a_list_names_the_path_it_came_from() {
    let (api, _) = serving(ApiSurface::Docker, r#"{"Volumes": "nope"}"#);

    let error = volumes::list(&api).await.expect_err("unreadable");

    let AdapterError::Malformed { path, .. } = error else {
        panic!("expected malformed, got {error:?}");
    };
    assert_eq!(path, "/volumes", "the envelope's path, not the element's");
}

#[tokio::test]
async fn a_single_get_takes_a_different_path_on_each_surface() {
    let (docker, docker_log) = serving(ApiSurface::Docker, "{}");
    volumes::get(&docker, "my vol").await.expect("the volume");
    assert_eq!(only(&docker_log).path, "/volumes/my%20vol");

    let (podman, podman_log) = serving(ApiSurface::Libpod, "{}");
    volumes::get(&podman, "my vol").await.expect("the volume");
    assert_eq!(
        only(&podman_log).path,
        format!("{LIBPOD_PATH_PREFIX}/volumes/my%20vol/json")
    );
}

#[tokio::test]
async fn a_create_sends_both_label_spellings_because_the_original_does() {
    let (api, log) = serving(ApiSurface::Libpod, "{}");
    let opts = CreateVolume {
        name: "data".to_string(),
        driver: "local".to_string(),
        label: vec![("a".to_string(), "1".to_string())],
        labels: vec![("b".to_string(), "2".to_string())],
        options: Vec::new(),
    };

    volumes::create(&api, &opts).await.expect("created");

    let request = only(&log);
    assert_eq!(request.path, format!("{LIBPOD_PATH_PREFIX}/volumes/create"));
    let body: Value = serde_json::from_str(request.body.as_deref().expect("a body")).expect("json");
    assert_eq!(body["Label"]["a"], "1");
    assert_eq!(body["Labels"]["b"], "2");
    assert_eq!(body["Options"], serde_json::json!({}));
}

#[tokio::test]
async fn a_remove_forces() {
    let (api, log) = serving(ApiSurface::Libpod, "null");

    volumes::remove(&api, "data").await.expect("removed");

    let request = only(&log);
    assert_eq!(request.method, "DELETE");
    assert_eq!(
        request.path,
        format!("{LIBPOD_PATH_PREFIX}/volumes/data?force=true")
    );
}
