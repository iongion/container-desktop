//! A pod's logs, fanned out over REST and merged.
//!
//! The log bodies are real Docker multiplexed frames, built byte by byte: an 8-byte header whose last
//! four are a big-endian length. An all-text fixture cannot see the demux at all.

use cdc_runtime::adapters::base_urls::LIBPOD_PATH_PREFIX;
use cdc_runtime::adapters::pods_rest;
use cdc_runtime::domain::types::engine::ApiSurface;

use super::fakes::{self, FakeHttp};
use super::{asked, bound, refused};

/// One stdout frame carrying `text`, as podman writes it.
fn frame(text: &str) -> Vec<u8> {
    let mut bytes = vec![1, 0, 0, 0];
    bytes.extend_from_slice(&(text.len() as u32).to_be_bytes());
    bytes.extend_from_slice(text.as_bytes());
    bytes
}

/// A pod with an infra container and two members.
const POD: &str = r#"{
  "Id": "pod1",
  "Name": "web-pod",
  "InfraContainerID": "infra1",
  "Containers": [
    {"Id": "infra1", "Names": ["/pod1-infra"]},
    {"Id": "c1", "Names": ["/web"]},
    {"Id": "c2", "Name": "api"}
  ]
}"#;

/// An engine that answers the pod inspect, and each member's log with its own frames.
fn pod_serving(
    logs: &'static [(&'static str, &'static str)],
) -> (cdc_runtime::adapters::shared::EngineApi, super::Log) {
    let known = |path: &str| {
        logs.iter()
            .any(|(id, _)| path.contains(&format!("/containers/{id}/logs")))
    };
    bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(move |request| {
            if request.path.contains("/pods/") {
                Ok(fakes::answered(200, POD))
            } else if known(&request.path) {
                Ok(fakes::answered(200, ""))
            } else {
                Ok(refused(
                    404,
                    "Not Found",
                    r#"{"message":"no such container"}"#,
                ))
            }
        })
        .delivering_per_request(move |request| {
            for (id, text) in logs {
                if request.path.contains(&format!("/containers/{id}/logs")) {
                    return vec![frame(text)];
                }
            }
            Vec::new()
        }),
    )
}

#[tokio::test]
async fn every_member_is_read_and_its_lines_carry_its_name() {
    let (api, log) = pod_serving(&[("c1", "listening on 8080\nready\n"), ("c2", "api up\n")]);

    let result = pods_rest::pod_logs(&api, "pod1", None)
        .await
        .expect("the pod's logs");

    assert!(result.success());
    assert_eq!(
        result.stdout, "web | listening on 8080\nweb | ready\napi | api up",
        "one prefix per LINE, not per member — a pod's output has to read like `podman pod logs`"
    );
    let paths: Vec<String> = asked(&log).into_iter().map(|it| it.path).collect();
    assert_eq!(
        paths,
        vec![
            format!("{LIBPOD_PATH_PREFIX}/pods/pod1/json"),
            format!(
                "{LIBPOD_PATH_PREFIX}/containers/c1/logs?stdout=true&stderr=true&tail=100&timestamps=false"
            ),
            format!(
                "{LIBPOD_PATH_PREFIX}/containers/c2/logs?stdout=true&stderr=true&tail=100&timestamps=false"
            ),
        ],
        "the whole path including its query — and the infra container is not among them"
    );
}

#[tokio::test]
async fn the_infra_container_carries_none_of_the_pods_output_and_is_skipped() {
    let (api, log) = pod_serving(&[("c1", "one\n"), ("c2", "two\n")]);

    pods_rest::pod_logs(&api, "pod1", None).await.expect("logs");

    assert!(
        !asked(&log).iter().any(|it| it.path.contains("infra1")),
        "asking it would put an empty section in every pod's logs"
    );
}

#[tokio::test]
async fn a_member_the_engine_cannot_read_is_reported_in_place_rather_than_losing_the_pod() {
    // Only c1 answers; c2 is 404 — a container the engine pruned between the inspect and the read.
    let (api, _) = pod_serving(&[("c1", "still here\n")]);

    let result = pods_rest::pod_logs(&api, "pod1", None)
        .await
        .expect("the pod's logs, not a failure");

    assert_eq!(result.stdout, "web | still here\napi | <logs unavailable>");
}

#[tokio::test]
async fn a_member_with_nothing_to_say_says_so() {
    let (api, _) = pod_serving(&[("c1", ""), ("c2", "")]);

    let result = pods_rest::pod_logs(&api, "pod1", None).await.expect("logs");

    assert_eq!(
        result.stdout, "web | <no logs>\napi | <no logs>",
        "an empty section would read as a member that was never asked"
    );
}

#[tokio::test]
async fn a_tail_the_caller_names_replaces_the_default_hundred() {
    let (api, log) = pod_serving(&[("c1", "x\n"), ("c2", "y\n")]);

    pods_rest::pod_logs(&api, "pod1", Some(5))
        .await
        .expect("logs");

    assert!(
        asked(&log)[1].path.contains("tail=5"),
        "got {}",
        asked(&log)[1].path
    );
}

#[tokio::test]
async fn a_name_is_read_from_name_then_names_and_never_keeps_dockers_leading_slash() {
    // `c1` has only `Names: ["/web"]`, `c2` has `Name: "api"`. Both must render bare.
    let (api, _) = pod_serving(&[("c1", "a\n"), ("c2", "b\n")]);

    let result = pods_rest::pod_logs(&api, "pod1", None).await.expect("logs");

    assert!(result.stdout.starts_with("web | "), "got {}", result.stdout);
    assert!(
        result.stdout.contains("\napi | "),
        "and the `Name` spelling too: {}",
        result.stdout
    );
}

#[tokio::test]
async fn a_member_with_no_name_at_all_is_labelled_by_its_id() {
    const NAMELESS: &str = r#"{"Id":"pod1","InfraContainerID":"infra1",
      "Containers":[{"Id":"infra1"},{"Id":"deadbeef"}]}"#;
    let (api, _) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|request| {
            if request.path.contains("/pods/") {
                Ok(fakes::answered(200, NAMELESS))
            } else {
                Ok(fakes::answered(200, ""))
            }
        })
        .delivering_per_request(|_| vec![frame("orphan\n")]),
    );

    let result = pods_rest::pod_logs(&api, "pod1", None).await.expect("logs");

    assert_eq!(result.stdout, "deadbeef | orphan");
}

#[tokio::test]
async fn a_member_whose_name_is_empty_falls_through_to_its_id() {
    // `Name: ""` is not a name. Without the emptiness check the prefix would be a bare `" | "`, which
    // says nothing about which container the line came from.
    const BLANK: &str = r#"{"Id":"pod1","InfraContainerID":"infra1",
      "Containers":[{"Id":"infra1"},{"Id":"c9","Name":"","Names":[]}]}"#;
    let (api, _) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|request| {
            if request.path.contains("/pods/") {
                Ok(fakes::answered(200, BLANK))
            } else {
                Ok(fakes::answered(200, ""))
            }
        })
        .delivering_per_request(|_| vec![frame("up\n")]),
    );

    let result = pods_rest::pod_logs(&api, "pod1", None).await.expect("logs");

    assert_eq!(result.stdout, "c9 | up");
}

#[tokio::test]
async fn a_pod_with_no_members_reads_as_nothing_rather_than_failing() {
    let (api, log) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|_| {
            Ok(fakes::answered(
                200,
                r#"{"Id":"pod1","InfraContainerID":"infra1","Containers":[{"Id":"infra1"}]}"#,
            ))
        }),
    );

    let result = pods_rest::pod_logs(&api, "pod1", None).await.expect("logs");

    assert_eq!(result.stdout, "");
    assert_eq!(asked(&log).len(), 1, "the inspect, and nothing after it");
}

#[tokio::test]
async fn a_pod_inspect_that_is_refused_reaches_the_caller() {
    // The one failure that IS fatal: with no member list there is nothing to fan out to, and answering
    // empty logs would read as a pod that is running quietly.
    let (api, _) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|_| Ok(refused(500, "Internal Server Error", r#"{"message":"no"}"#))),
    );

    pods_rest::pod_logs(&api, "pod1", None)
        .await
        .expect_err("a refusal");
}

#[tokio::test]
async fn an_unframed_body_is_read_whole_rather_than_demultiplexed_into_nothing() {
    // podman answers a plain body when the container has no TTY multiplexing; the shared decoder falls
    // back to the whole body, and this is the path that proves the adapter uses that decoder.
    let (api, _) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|request| {
            if request.path.contains("/pods/") {
                Ok(fakes::answered(200, POD))
            } else {
                Ok(fakes::answered(200, ""))
            }
        })
        .delivering_per_request(|_| vec![b"plain text\n".to_vec()]),
    );

    let result = pods_rest::pod_logs(&api, "pod1", None).await.expect("logs");

    assert_eq!(result.stdout, "web | plain text\napi | plain text");
}
