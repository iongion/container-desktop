//! The image adapter, against real captures from podman 5.7.0.

use cdc_runtime::adapters::images::{self, PushOptions};
use cdc_runtime::domain::types::engine::ApiSurface;

use super::{asked, only, routed, serving};

/// One row of real `GET /images/json` on the compat route — podman answers `Names` there, which
/// Docker does not, and `History` is a list of NAMES rather than layers.
const LIST: &str = r#"[{
  "Id": "1c65d54bce7e0014d559163590c647fc47bc5c7ca6b5d3408b92168cc901853f",
  "Names": ["docker.io/library/httpd:latest"],
  "RepoTags": ["docker.io/library/httpd:latest"],
  "History": ["docker.io/library/httpd:latest"],
  "Labels": null,
  "Created": 1781137394,
  "Size": 120227625
}]"#;

#[tokio::test]
async fn a_real_image_row_reads_whole_and_its_name_is_split_off_the_first_tag() {
    let (api, log) = serving(ApiSurface::Libpod, LIST);

    let images = images::list(&api).await.expect("the list");

    assert_eq!(only(&log).path, "/images/json", "the connection's own root");
    let image = &images[0];
    assert_eq!(image.registry, "docker.io");
    assert_eq!(image.name, "library/httpd");
    assert_eq!(image.tag, "latest");
    assert_eq!(image.full_name, "library/httpd:latest");
    assert!(
        image.history.is_empty(),
        "libpod's `History` key is a list of names and must never land in the layers field"
    );
}

#[tokio::test]
async fn an_image_id_is_not_encoded_because_an_image_is_addressed_by_name_and_tag() {
    let (api, log) = serving(ApiSurface::Libpod, "{}");

    images::get(&api, "nginx:latest", false)
        .await
        .expect("the image");

    assert_eq!(
        only(&log).path,
        "/images/nginx:latest/json",
        "encoding the colon would change the request rather than escape it"
    );
}

#[tokio::test]
async fn asking_for_history_fills_the_apps_own_layers_field() {
    let (api, log) = routed(
        ApiSurface::Libpod,
        &[
            (
                "/images/abc/history",
                200,
                r#"[{"Id":"layer","Size":42,"Created":"2026-01-01T00:00:00Z"}]"#,
            ),
            (
                "/images/abc/json",
                200,
                r#"{"Id":"abc","RepoTags":["nginx:1"]}"#,
            ),
        ],
    );

    let image = images::get(&api, "abc", true).await.expect("the image");

    assert_eq!(image.history.len(), 1);
    assert_eq!(image.history[0].size, 42);
    let paths: Vec<String> = asked(&log).iter().map(|it| it.path.clone()).collect();
    assert_eq!(paths, vec!["/images/abc/json", "/images/abc/history"]);
}

#[tokio::test]
async fn a_history_that_fails_leaves_the_image_whole() {
    let (api, _) = routed(
        ApiSurface::Libpod,
        &[
            ("/images/abc/history", 500, "boom"),
            (
                "/images/abc/json",
                200,
                r#"{"Id":"abc","RepoTags":["nginx:1"]}"#,
            ),
        ],
    );

    let image = images::get(&api, "abc", true).await.expect("the image");

    assert_eq!(image.id, "abc");
    assert!(image.history.is_empty());
}

#[tokio::test]
async fn a_pull_encodes_the_reference_it_asks_for() {
    let (api, log) = serving(ApiSurface::Libpod, "null");

    images::pull(&api, "docker.io/library/nginx:latest")
        .await
        .expect("the pull");

    assert_eq!(
        only(&log).path,
        "/images/pull?reference=docker.io%2Flibrary%2Fnginx%3Alatest"
    );
}

#[tokio::test]
async fn a_push_sends_the_originals_misspelled_verify_flag_and_only_when_it_is_false() {
    let (api, log) = serving(ApiSurface::Libpod, "null");

    images::push(&api, "abc", &PushOptions::default())
        .await
        .expect("bare");
    images::push(
        &api,
        "abc",
        &PushOptions {
            destination: Some("registry.local/mine".to_string()),
            tls_verify: Some(true),
        },
    )
    .await
    .expect("verified");
    images::push(
        &api,
        "abc",
        &PushOptions {
            destination: None,
            tls_verify: Some(false),
        },
    )
    .await
    .expect("unverified");

    let paths: Vec<String> = asked(&log).iter().map(|it| it.path.clone()).collect();
    assert_eq!(
        paths,
        vec![
            "/images/abc/push",
            "/images/abc/push?destination=registry.local%2Fmine",
            "/images/abc/push?tslVerify=false",
        ],
        "`tslVerify` is the engine's own parameter name in the original; correcting it would change \
         which pushes skip verification"
    );
}

#[tokio::test]
async fn removing_an_image_is_a_delete_on_its_bare_id() {
    let (api, log) = serving(ApiSurface::Libpod, "null");

    images::remove(&api, "abc").await.expect("removed");

    let request = only(&log);
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("DELETE", "/images/abc")
    );
}
