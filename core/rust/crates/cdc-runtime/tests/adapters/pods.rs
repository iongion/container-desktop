//! The pod adapter — libpod's alone, so every call carries the prefix.

use cdc_runtime::adapters::base_urls::LIBPOD_PATH_PREFIX;
use cdc_runtime::adapters::pods::{self, CreatePod, CreatedPod};
use cdc_runtime::adapters::shared::AdapterError;
use cdc_runtime::domain::types::engine::ApiSurface;
use serde_json::Value;

use super::{asked, only, routed, serving};

const POD: &str = r#"[{
  "Id": "abc", "Name": "web", "Status": "Running", "Created": "2026-08-03T09:49:04Z",
  "Containers": null, "InfraId": "infra", "Labels": null, "Networks": null
}]"#;

#[tokio::test]
async fn the_list_asks_for_every_pod_on_the_libpod_root_and_survives_a_null_container_list() {
    let (api, log) = serving(ApiSurface::Libpod, POD);

    let found = pods::list(&api).await.expect("the list");

    assert_eq!(
        only(&log).path,
        format!("{LIBPOD_PATH_PREFIX}/pods/json?all=true")
    );
    assert_eq!(found[0].name, "web");
    assert!(found[0].is_running());
    assert!(found[0].containers.is_empty());
    assert_eq!(
        found[0].processes.titles.len(),
        0,
        "the normalizer seeds an empty report"
    );
}

#[tokio::test]
async fn a_top_answering_null_is_an_empty_report_rather_than_a_failure() {
    let (api, log) = serving(ApiSurface::Libpod, "null");

    let report = pods::processes(&api, "abc").await.expect("the report");

    assert_eq!(
        only(&log).path,
        format!("{LIBPOD_PATH_PREFIX}/pods/abc/top")
    );
    assert!(report.titles.is_empty() && report.processes.is_empty());
}

#[tokio::test]
async fn a_top_that_answered_is_read_as_it_arrived() {
    const TOP: &str = r#"{"Processes":[["root","1","httpd"]],"Titles":["USER","PID","COMMAND"]}"#;
    let (api, _) = serving(ApiSurface::Libpod, TOP);

    let report = pods::processes(&api, "abc").await.expect("the report");

    assert_eq!(report.processes[0], vec!["root", "1", "httpd"]);
}

#[tokio::test]
async fn a_top_that_answered_something_unreadable_is_malformed_and_not_an_empty_report() {
    let (api, _) = serving(ApiSurface::Libpod, r#"{"Titles": 7}"#);

    let error = pods::processes(&api, "abc").await.expect_err("unreadable");

    let AdapterError::Malformed { path, .. } = error else {
        panic!("expected malformed, got {error:?}");
    };
    assert_eq!(
        path, "/pods/abc/top",
        "the path without the prefix, which is what the caller asked for"
    );
}

#[tokio::test]
async fn a_create_names_the_pod_in_the_query_and_the_body() {
    let (api, log) = serving(ApiSurface::Libpod, r#"{"Id":"new-pod"}"#);
    let opts = CreatePod {
        name: "web".to_string(),
        start: false,
    };

    let created = pods::create(&api, &opts).await.expect("created");

    assert_eq!(
        created,
        CreatedPod {
            id: "new-pod".to_string(),
            started: false
        }
    );
    let request = only(&log);
    assert_eq!(
        request.path,
        format!("{LIBPOD_PATH_PREFIX}/pods/create?name=web")
    );
    let body: Value = serde_json::from_str(request.body.as_deref().expect("a body")).expect("json");
    assert_eq!(body, serde_json::json!({ "name": "web" }));
}

#[tokio::test]
async fn an_unnamed_create_sends_no_query() {
    let (api, log) = serving(ApiSurface::Libpod, r#"{"Id":"new-pod"}"#);

    pods::create(&api, &CreatePod::default())
        .await
        .expect("created");

    assert_eq!(only(&log).path, format!("{LIBPOD_PATH_PREFIX}/pods/create"));
}

#[tokio::test]
async fn a_create_that_was_asked_to_start_starts_what_it_made() {
    let (api, log) = routed(
        ApiSurface::Libpod,
        &[
            ("/v4.0.0/libpod/pods/create", 201, r#"{"Id":"new-pod"}"#),
            ("/v4.0.0/libpod/pods/new-pod/start", 200, "null"),
        ],
    );
    let opts = CreatePod {
        name: "web".to_string(),
        start: true,
    };

    let created = pods::create(&api, &opts).await.expect("created");

    assert!(created.started);
    assert_eq!(
        asked(&log)[1].path,
        format!("{LIBPOD_PATH_PREFIX}/pods/new-pod/start")
    );
}

#[tokio::test]
async fn every_lifecycle_call_posts_a_null_body_and_takes_the_hosts_own_timeout() {
    let (api, log) = serving(ApiSurface::Libpod, "null");

    pods::stop(&api, "abc").await.expect("stop");
    pods::start(&api, "abc").await.expect("start");
    pods::restart(&api, "abc").await.expect("restart");
    pods::pause(&api, "abc").await.expect("pause");
    pods::unpause(&api, "abc").await.expect("unpause");
    pods::kill(&api, "abc").await.expect("kill");

    let requests = asked(&log);
    let verbs: Vec<String> = requests
        .iter()
        .map(|it| it.path.rsplit('/').next().expect("a verb").to_string())
        .collect();
    assert_eq!(
        verbs,
        vec!["stop", "start", "restart", "pause", "unpause", "kill"]
    );
    for request in &requests {
        assert_eq!(request.method, "POST");
        assert_eq!(request.body.as_deref(), Some("null"));
        assert_eq!(
            request.timeout, None,
            "unlike a container's stop, a pod's is not given the lifecycle budget"
        );
        assert!(request.path.starts_with(LIBPOD_PATH_PREFIX));
    }
}

#[tokio::test]
async fn a_remove_takes_the_pods_volumes_with_it() {
    let (api, log) = serving(ApiSurface::Libpod, "null");

    pods::remove(&api, "abc").await.expect("removed");

    let request = only(&log);
    assert_eq!(request.method, "DELETE");
    assert_eq!(
        request.path,
        format!("{LIBPOD_PATH_PREFIX}/pods/abc?force=true&v=true")
    );
}

#[tokio::test]
async fn a_single_get_is_normalized_like_a_list_row() {
    let (api, log) = serving(
        ApiSurface::Libpod,
        r#"{"Id":"abc","Name":"web","Containers":null}"#,
    );

    let pod = pods::get(&api, "abc").await.expect("the pod");

    assert_eq!(
        only(&log).path,
        format!("{LIBPOD_PATH_PREFIX}/pods/abc/json")
    );
    assert!(pod.containers.is_empty());
}
