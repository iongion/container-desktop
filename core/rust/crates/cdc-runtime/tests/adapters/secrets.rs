//! The secret adapter, and what a Docker that is not a swarm manager really answers.

use cdc_runtime::adapters::base_urls::LIBPOD_PATH_PREFIX;
use cdc_runtime::adapters::secrets::{self, CreateSecret};
use cdc_runtime::adapters::shared::AdapterError;
use cdc_runtime::domain::types::engine::ApiSurface;
use serde_json::Value;

use super::fakes::FakeHttp;
use super::{bound, only, refused, serving};

/// Real `GET http://d/v4.0.0/libpod/secrets/json` — `Spec.Labels` is `null`.
const LIST: &str = r#"[{
  "ID": "10731ccdf200b953774b94223",
  "CreatedAt": "2026-06-16T12:18:19.190139732+02:00",
  "UpdatedAt": "2026-06-16T12:18:19.190139732+02:00",
  "Spec": {"Name": "test", "Driver": {"Name": "file", "Options": {"path": "/x"}}, "Labels": null}
}]"#;

#[tokio::test]
async fn a_real_secret_row_reads_whole_off_the_surface_root() {
    let (api, log) = serving(ApiSurface::Libpod, LIST);

    let found = secrets::list(&api).await.expect("the list");

    assert_eq!(
        only(&log).path,
        format!("{LIBPOD_PATH_PREFIX}/secrets/json")
    );
    assert_eq!(found[0].id, "10731ccdf200b953774b94223");
    assert_eq!(found[0].spec.name, "test");
    assert_eq!(found[0].spec.driver.name, "file");
}

#[tokio::test]
async fn a_docker_that_is_not_a_swarm_manager_says_so_instead_of_answering_nothing() {
    // Measured on Docker 29.7.0: 503, with this sentence.
    const SWARM: &str =
        r#"{"message":"This node is not a swarm manager. Use \"docker swarm init\"."}"#;
    let (api, _) = bound(
        ApiSurface::Docker,
        FakeHttp::scripted(|_| Ok(refused(503, "Service Unavailable", SWARM))),
    );

    let error = secrets::list(&api).await.expect_err("a refusal");

    let AdapterError::Refused { status, body, .. } = error else {
        panic!("expected a refusal, got {error:?}");
    };
    assert_eq!(status, 503);
    assert!(
        body.contains("swarm init"),
        "the original turns this into an empty list, which tells nobody what to do"
    );
}

#[tokio::test]
async fn a_create_puts_the_name_in_the_query_and_the_secret_in_the_body() {
    let (api, log) = serving(ApiSurface::Libpod, "{}");
    let opts = CreateSecret {
        name: "my secret".to_string(),
        secret: "s3cr3t".to_string(),
        driver: None,
    };

    secrets::create(&api, &opts).await.expect("created");

    let request = only(&log);
    assert_eq!(
        request.path,
        format!("{LIBPOD_PATH_PREFIX}/secrets/create?name=my%20secret")
    );
    let body: Value = serde_json::from_str(request.body.as_deref().expect("a body")).expect("json");
    assert_eq!(body, serde_json::json!({ "Secret": "s3cr3t" }));
}

#[tokio::test]
async fn a_driver_is_sent_only_when_one_was_asked_for() {
    let (api, log) = serving(ApiSurface::Libpod, "{}");
    let opts = CreateSecret {
        name: "x".to_string(),
        secret: "y".to_string(),
        driver: Some("file".to_string()),
    };

    secrets::create(&api, &opts).await.expect("created");

    assert_eq!(
        only(&log).path,
        format!("{LIBPOD_PATH_PREFIX}/secrets/create?name=x&driver=file")
    );
}

#[tokio::test]
async fn a_get_and_a_remove_address_the_secret_by_name_or_id() {
    let (api, log) = serving(ApiSurface::Libpod, "{}");

    secrets::get(&api, "test").await.expect("the secret");
    secrets::remove(&api, "test").await.expect("removed");

    let requests = super::asked(&log);
    assert_eq!(
        requests[0].path,
        format!("{LIBPOD_PATH_PREFIX}/secrets/test/json")
    );
    assert_eq!(requests[1].method, "DELETE");
    assert_eq!(
        requests[1].path,
        format!("{LIBPOD_PATH_PREFIX}/secrets/test?force=true")
    );
}
