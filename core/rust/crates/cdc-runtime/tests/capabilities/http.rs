//! The engine-API capability, as far as it is decided rather than performed.
//!
//! Two decisions live here and both are the runtime's, not a host's: what the readiness question IS,
//! and which answers count as the engine serving. A host that reimplemented either would be a second
//! opinion about readiness, which is precisely the defect found — `ready` reported over a
//! socket with no listener.

use cdc_runtime::capabilities::http::{Endpoint, HttpRequest, HttpResponse};

fn response(status: u16) -> HttpResponse {
    HttpResponse {
        status,
        status_text: String::new(),
        headers: Vec::new(),
        body: String::new(),
    }
}

#[test]
fn the_readiness_question_is_a_get_of_the_engine_ping_route_with_no_body() {
    // `services.ts:startTunnel` calls a tunnel ready when `GET /_ping` answers, so the route and the
    // method are the oracle's, not a preference. A body on a readiness probe would be sent to every
    // engine on every attempt.
    let request = HttpRequest::ping(Endpoint::UnixSocket(
        "/run/user/1000/podman.sock".to_string(),
    ));

    assert_eq!(request.method, "GET");
    assert_eq!(request.path, "/_ping");
    assert_eq!(request.body, None);
    assert_eq!(
        request.endpoint,
        Endpoint::UnixSocket("/run/user/1000/podman.sock".to_string())
    );
}

#[test]
fn the_readiness_question_carries_no_headers_of_its_own() {
    // Which `Host` a daemon expects comes from `api.baseURL`, which belongs to the CONNECTION. A
    // constructor that filled one in would be a second opinion about it, and the placeholder it would
    // have to guess is the one the host already applies when nobody says otherwise.
    let request = HttpRequest::ping(Endpoint::UnixSocket("/run/podman.sock".to_string()));

    assert!(request.headers.is_empty());
    assert_eq!(
        request.timeout, None,
        "and no deadline of its own — the host's default is the oracle's 3000ms"
    );
}

#[test]
fn the_probe_keeps_whichever_transport_it_was_asked_of() {
    // The endpoint is asked of the ADDRESS, never of the OS: a Windows remote reached over an SSH relay
    // is a named pipe on a POSIX client, and a probe that substituted the local convention would ask
    // the wrong question.
    for endpoint in [
        Endpoint::UnixSocket("/var/run/docker.sock".to_string()),
        Endpoint::NamedPipe(r"\\.\pipe\docker_engine".to_string()),
        Endpoint::Tcp("127.0.0.1:2375".to_string()),
    ] {
        assert_eq!(HttpRequest::ping(endpoint.clone()).endpoint, endpoint);
    }
}

#[test]
fn every_two_hundred_answer_means_the_engine_is_serving_not_only_two_hundred_itself() {
    // Podman answers 204 to routes the oracle treats as fine, so a check that insisted on `== 200`
    // would call a working engine unavailable.
    for status in [200, 201, 204, 299] {
        assert!(response(status).ok(), "{status} is a success");
    }
}

#[test]
fn anything_outside_the_two_hundreds_is_not_the_engine_serving() {
    // 404 is the interesting one: a collector or a proxy on the right port answering the wrong route
    // looks alive at the socket level and is not the engine.
    for status in [0, 100, 199, 300, 301, 404, 500, 503] {
        assert!(!response(status).ok(), "{status} is not a success");
    }
}
