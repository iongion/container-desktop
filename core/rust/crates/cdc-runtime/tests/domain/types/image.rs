//! An image, and the three name lists whose ABSENCE the normalizer branches on.

use cdc_runtime::domain::types::image::{
    ContainerImage, ContainerImageMountAccess, ContainerImageMountDriver, ContainerImageMountType,
    ContainerImagePortProtocol,
};
use serde_json::json;

/// One row of real `GET /v4.0.0/libpod/images/json`.
pub fn podman_list_row() -> serde_json::Value {
    json!({
        "Id": "1c65d54bce7e0014d559163590c647fc47bc5c7ca6b5d3408b92168cc901853f",
        "ParentId": "",
        "RepoTags": ["docker.io/library/httpd:latest"],
        "RepoDigests": ["docker.io/library/httpd@sha256:939797d877aeeb5cc"],
        "Created": 1_781_137_394,
        "Size": 120_227_625,
        "SharedSize": 0,
        "VirtualSize": 120_227_625,
        "Labels": null,
        "Containers": 1,
        "Digest": "sha256:b7c88cc3708bab3cc33ed0bc45657165453ba34bc783ba30dd9dc33746d51597",
        "History": ["docker.io/library/httpd:latest"],
        "Names": ["docker.io/library/httpd:latest"]
    })
}

/// One row of real `GET /images/json` on the Docker surface — no `Names` at all.
pub fn docker_list_row() -> serde_json::Value {
    json!({
        "Containers": 0,
        "Created": 1_785_655_069,
        "Id": "sha256:6c29bb1b5b6452f98a8ccb44af12a11e1765c76cfa4df2908a5308ec537407d8",
        "Labels": {"com.docker.compose.project": "container-desktop-dev"},
        "ParentId": "",
        "RepoDigests": ["container-desktop-ssh-remote@sha256:6c29bb1b"],
        "RepoTags": ["container-desktop-ssh-remote:dev"],
        "SharedSize": -1,
        "Size": 525_159_599
    })
}

#[test]
fn a_real_podman_row_reads_whole_and_its_history_key_is_not_the_layers_field() {
    let image: ContainerImage = serde_json::from_value(podman_list_row()).expect("podman row");

    assert_eq!(
        image.names.as_deref(),
        Some(&["docker.io/library/httpd:latest".to_string()][..])
    );
    assert!(image.labels.is_empty(), "podman answers `Labels: null`");
    // libpod's `History` is a list of NAMES. Reading it into the layers field would fail to parse —
    // the field is the app's own and is filled from `/images/{id}/history`.
    assert!(image.history.is_empty());
}

#[test]
fn a_real_docker_row_has_no_names_and_that_is_what_the_normalizer_branches_on() {
    let image: ContainerImage = serde_json::from_value(docker_list_row()).expect("docker row");

    assert_eq!(
        image.names, None,
        "absent, not empty — the two take different branches"
    );
    assert_eq!(image.names_history, None);
    assert_eq!(
        image.repo_tags.as_deref(),
        Some(&["container-desktop-ssh-remote:dev".to_string()][..])
    );
}

#[test]
fn an_empty_names_list_is_not_an_absent_one() {
    let image: ContainerImage =
        serde_json::from_value(json!({"Id": "x", "Names": [], "NamesHistory": ["old:1"]}))
            .expect("an image with an empty name list");

    assert_eq!(image.names, Some(Vec::new()));
    assert!(image.names_history.is_some());
}

#[test]
fn an_absent_optional_never_comes_back_as_null() {
    let written = serde_json::to_value(ContainerImage::default()).expect("an image serializes");
    let object = written.as_object().expect("an object");

    for key in ["Names", "NamesHistory", "RepoTags", "RepoDigests"] {
        assert!(!object.contains_key(key), "{key} was written as null");
    }
}

#[test]
fn the_image_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(ContainerImageMountType::VOCABULARY);
    super::agrees_on_the_wire(ContainerImageMountAccess::VOCABULARY);
    super::agrees_on_the_wire(ContainerImageMountDriver::VOCABULARY);
    super::agrees_on_the_wire(ContainerImagePortProtocol::VOCABULARY);
}
