//! The two engine seams: which root a call names, and what a refusal carries.

use std::time::Duration;

use cdc_runtime::adapters::base_urls::{LIBPOD_PATH_PREFIX, LIFECYCLE_TIMEOUT};
use cdc_runtime::adapters::shared::{AdapterError, ApiCall, component};
use cdc_runtime::domain::types::engine::ApiSurface;
use serde_json::{Value, json};

use super::fakes::FakeHttp;
use super::{bound, only, refused, serving};

#[test]
fn the_component_encoder_leaves_exactly_what_javascript_leaves() {
    // `encodeURIComponent`'s unreserved set. `-` matters: `ps_args=-aux` is a real query value.
    assert_eq!(component("-_.!~*'()"), "-_.!~*'()");
    assert_eq!(
        component("docker.io/library/nginx:latest"),
        "docker.io%2Flibrary%2Fnginx%3Alatest"
    );
    assert_eq!(component("a b"), "a%20b");
}

#[tokio::test]
async fn a_connection_rooted_call_sends_the_path_bare_on_both_surfaces() {
    for surface in [ApiSurface::Libpod, ApiSurface::Docker] {
        let (api, log) = serving(surface, "{}");
        let _: Value = api
            .read(&ApiCall::get("/containers/json"))
            .await
            .expect("read");
        assert_eq!(only(&log).path, "/containers/json");
    }
}

#[tokio::test]
async fn a_surface_rooted_call_is_prefixed_on_libpod_and_not_on_docker() {
    let (podman, podman_log) = serving(ApiSurface::Libpod, "{}");
    let _: Value = podman
        .read(&ApiCall::get("/volumes/json").on_surface())
        .await
        .expect("read");
    assert_eq!(
        only(&podman_log).path,
        format!("{LIBPOD_PATH_PREFIX}/volumes/json")
    );

    let (docker, docker_log) = serving(ApiSurface::Docker, "{}");
    let _: Value = docker
        .read(&ApiCall::get("/volumes").on_surface())
        .await
        .expect("read");
    assert_eq!(only(&docker_log).path, "/volumes");
}

#[tokio::test]
async fn a_non_2xx_is_a_refusal_that_carries_the_status_the_phrase_and_the_body() {
    // Real Docker 29.7.0, asked for secrets on a node that is not a swarm manager.
    const SWARM: &str = r#"{"message":"This node is not a swarm manager."}"#;
    let (api, _) = bound(
        ApiSurface::Docker,
        FakeHttp::scripted(|_| Ok(refused(503, "Service Unavailable", SWARM))),
    );

    let error = api
        .read::<Value>(&ApiCall::get("/secrets/json"))
        .await
        .expect_err("a refusal");

    let AdapterError::Refused {
        method,
        path,
        status,
        status_text,
        body,
    } = error
    else {
        panic!("expected a refusal, got {error:?}");
    };
    assert_eq!((method.as_str(), path.as_str()), ("GET", "/secrets/json"));
    assert_eq!((status, status_text.as_str()), (503, "Service Unavailable"));
    assert_eq!(
        body, SWARM,
        "the engine's own sentence is the actionable part"
    );
}

#[tokio::test]
async fn a_2xx_body_this_port_cannot_read_is_malformed_and_not_a_refusal() {
    let (api, _) = serving(ApiSurface::Libpod, "[1, 2, 3]");

    let error = api
        .read::<Vec<String>>(&ApiCall::get("/containers/json"))
        .await
        .expect_err("unreadable");

    assert!(
        matches!(error, AdapterError::Malformed { .. }),
        "a machine in good order answering a shape we cannot read is a PORT defect, not a refusal: {error:?}"
    );
}

#[tokio::test]
async fn an_unreachable_engine_is_neither_of_the_other_two() {
    let (api, _) = bound(ApiSurface::Libpod, FakeHttp::silent());

    let error = api
        .read::<Value>(&ApiCall::get("/containers/json"))
        .await
        .expect_err("unreachable");

    assert!(matches!(error, AdapterError::Unreachable(_)), "{error:?}");
}

#[tokio::test]
async fn a_calls_own_header_replaces_the_connections_whatever_its_case() {
    let (api, log) = serving(ApiSurface::Libpod, "{}");

    let _: Value = api
        .read(&ApiCall::get("/x").as_octet_stream())
        .await
        .expect("read");

    let headers = only(&log).headers;
    assert_eq!(
        headers,
        vec![
            ("Host".to_string(), "d".to_string()),
            ("Accept".to_string(), "application/octet-stream".to_string()),
            (
                "Content-Type".to_string(),
                "application/octet-stream".to_string()
            ),
        ],
        "replaced in place, not appended beside the JSON pair it overrides"
    );
}

#[tokio::test]
async fn a_json_body_travels_compact_and_adds_no_header() {
    let (api, log) = serving(ApiSurface::Libpod, "{}");
    let call = ApiCall::get("/x").sending(json!({ "a": 1 }));

    let _: Value = api.read(&call).await.expect("read");

    let request = only(&log);
    assert_eq!(request.body.as_deref(), Some(r#"{"a":1}"#));
    assert_eq!(request.headers.len(), 3, "nothing was added or dropped");
}

#[tokio::test]
async fn a_header_the_connection_never_sent_is_appended_rather_than_dropped() {
    // A connection whose headers do not include the content pair — which is what a caller composing
    // its own `EngineApi` may hand in, since the header list arrives already resolved.
    let http = FakeHttp::scripted(|_| Ok(super::fakes::answered(200, "{}")));
    let log = http.log();
    let api = cdc_runtime::adapters::shared::EngineApi::new(
        std::sync::Arc::new(http),
        cdc_runtime::capabilities::http::Endpoint::UnixSocket(super::SOCKET.to_string()),
        vec![("Host".to_string(), super::HOST_HEADER.to_string())],
        ApiSurface::Libpod,
    );

    let _: Value = api
        .read(&ApiCall::get("/x").as_octet_stream())
        .await
        .expect("read");

    assert_eq!(
        only(&log).headers,
        vec![
            ("Host".to_string(), "d".to_string()),
            ("Accept".to_string(), "application/octet-stream".to_string()),
            (
                "Content-Type".to_string(),
                "application/octet-stream".to_string()
            ),
        ]
    );
}

#[tokio::test]
async fn only_a_lifecycle_call_is_given_a_timeout() {
    let (api, log) = serving(ApiSurface::Libpod, "{}");

    api.send(&ApiCall::post("/quick")).await.expect("quick");
    api.send(&ApiCall::post("/slow").slow())
        .await
        .expect("slow");

    let requests = super::asked(&log);
    assert_eq!(requests[0].timeout, None, "the host's own default applies");
    assert_eq!(requests[1].timeout, Some(LIFECYCLE_TIMEOUT));
    assert_eq!(LIFECYCLE_TIMEOUT, Duration::from_secs(60));
}

#[tokio::test]
async fn draining_a_body_keeps_every_byte_including_the_ones_that_are_not_text() {
    // A real container log frame: stream 2, length 0xac. `from_utf8_lossy` turns that one byte into
    // three and the framing is gone.
    const FRAME: &[u8] = &[0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xac];
    let (api, _) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|_| Ok(super::fakes::answered(200, "")))
            .delivering_bytes(&[FRAME, b"AH00558"]),
    );

    let drained = api.drain(&ApiCall::get("/logs")).await.expect("drained");

    assert_eq!(&drained[..8], FRAME);
    assert_eq!(&drained[8..], b"AH00558");
}

#[tokio::test]
async fn a_stream_whose_head_is_not_2xx_is_refused_before_the_body_is_touched() {
    let (api, _) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|_| Ok(refused(404, "Not Found", "no such container")))
            .delivering(&["never read"]),
    );

    let error = api.open(&ApiCall::get("/logs")).await.expect_err("refused");

    let AdapterError::Refused { status, body, .. } = error else {
        panic!("expected a refusal, got {error:?}");
    };
    assert_eq!(status, 404);
    assert!(
        body.is_empty(),
        "reading a refused stream's body would consume the caller's stream"
    );
}
