//! Forwarding a client's engine HTTP through the connection — `src/domain/machine/proxy.rs`.
//!
//! What has to be pinned here is everything that decides WHAT LEAVES THE PROCESS: the address, the
//! method, the path, the headers a daemon selects on, and the body. A forward that asked a slightly
//! different question than the client meant is the failure mode this whole module exists to avoid, and
//! it is invisible in every state assertion.
//!
//! The engine's own answer is scripted by PATH, so a connection can be brought up honestly (the
//! readiness probe really pings) and the forwarded request still get whatever the case is about.

use cdc_runtime::domain::machine::proxy::ForwardedResponse;
use cdc_runtime::domain::types::command_proxy_protocol::CommandProxyRequestPayload;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use serde_json::{Value, json};

use cdc_runtime::domain::machine::ConnectionContext;

use crate::fakes::APP_VERSION;
use crate::fakes::{FakeCommand, FakeHttp, answered};
use crate::harness::{
    Harness, connection, engine_is_healthy, engine_socket_bound, linux, options, podman,
};

/// The socket a healthy Podman reports, as the endpoint a forward must reach.
const ENGINE_SOCKET: &str = "/run/podman.sock";

/// More pieces than any fixture here delivers, and the bound a drain gives up at.
///
/// **Not tidiness — it is what stops a test from taking the machine down.** A mutant that removes a
/// loop's exit makes a body yield forever, and an unbounded `while let` then allocates until the
/// kernel OOM-kills the cgroup, which under `cargo mutants` is the run's own scope and every sibling
/// job in it. That is an infrastructure outcome rather than a defect in the code under test, and the
/// only honest place to fix it is the test's own organization.
const MOST_CHUNKS: usize = 64;

fn payload(req: Value) -> CommandProxyRequestPayload {
    CommandProxyRequestPayload {
        connection: None,
        req: req.as_object().cloned().expect("a req object"),
    }
}

/// An engine that is up for the readiness probe and answers `status`/`body` to everything else.
fn engine_answering(status: u16, body: &'static str) -> FakeHttp {
    FakeHttp::scripted(move |request| {
        if request.path == "/_ping" {
            return Ok(answered(200, "OK"));
        }
        Ok(answered(status, body))
    })
}

/// A connection that has come up, so its settings carry a resolved address.
async fn connected(http: FakeHttp) -> Harness {
    let mut harness = Harness::with_http(
        options(podman(), false),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        http,
    );
    harness.connect(0).await;
    harness
}

fn buffered(
    forwarded: ForwardedResponse,
) -> cdc_runtime::domain::types::command_proxy_protocol::CommandProxyResponse {
    match forwarded {
        ForwardedResponse::Buffered(response) => response,
        ForwardedResponse::Stream(_) => panic!("expected a whole response, got a stream"),
    }
}

#[tokio::test]
async fn a_forward_reaches_the_same_address_the_readiness_probe_did() {
    // One address, asked twice. A forward that resolved it differently would report an engine as up
    // and then send its traffic somewhere else — which is the defect `probe_api` was fixed for, on the
    // other side of the same question.
    let harness = connected(engine_answering(200, "[]")).await;

    harness
        .machine
        .forward(&payload(
            json!({ "method": "get", "url": "/containers/json" }),
        ))
        .await
        .expect("the engine answered");

    let asked = harness.pinged();
    let forwarded = asked.last().expect("the forward reached the capability");
    assert_eq!(
        forwarded.endpoint,
        cdc_runtime::capabilities::http::Endpoint::UnixSocket(ENGINE_SOCKET.to_string())
    );
    assert_eq!(
        forwarded.method, "GET",
        "axios upper-cases it and so must this: an engine route table is case-sensitive"
    );
    assert_eq!(forwarded.path, "/containers/json");
    assert_eq!(forwarded.body, None);
}

#[tokio::test]
async fn a_request_that_names_no_method_is_a_get() {
    let harness = connected(engine_answering(200, "{}")).await;

    harness
        .machine
        .forward(&payload(json!({ "url": "/_ping" })))
        .await
        .expect("the engine answered");

    assert_eq!(harness.pinged().last().expect("a forward").method, "GET");
}

#[tokio::test]
async fn every_forward_carries_the_host_the_daemon_expects() {
    // `api.baseURL` is `http://d` for Podman and `http://localhost` for Docker and Apple, and the
    // field's own doc says that is not cosmetic — it selects the Host header. A forward that sent the
    // transport's placeholder would be talking to the wrong virtual host on an engine that checks.
    let harness = connected(engine_answering(200, "{}")).await;

    harness
        .machine
        .forward(&payload(json!({ "url": "/info" })))
        .await
        .expect("the engine answered");

    let headers = harness.pinged().last().expect("a forward").headers.clone();
    assert!(
        headers.contains(&("Host".to_string(), "d".to_string())),
        "the authority of http://d: {headers:?}"
    );
    assert!(
        headers.contains(&("Accept".to_string(), "application/json".to_string())),
        "getApiConfig's defaults travel with every request: {headers:?}"
    );
    assert!(
        headers.contains(&("Content-Type".to_string(), "application/json".to_string())),
        "Docker and Podman both require it on a write: {headers:?}"
    );
}

#[tokio::test]
async fn every_request_names_the_app_that_made_it() {
    // `Api.clients.ts:getApiConfig` — `User-Agent: Container Desktop <version>`. An engine's log is
    // where a support question is answered from, and a request with no agent in it is one nobody can
    // attribute.
    //
    // **It is the APP's version and never the document's.** This core also holds a version — the
    // schema stamp it writes into `user-settings.json` — and they are different numbers. Putting that
    // one here would name a Container Desktop that does not exist, which is why the field is on the
    // CONTEXT, beside `home` and `arch`: host knowledge, arriving as data.
    let harness = connected(engine_answering(200, "{}")).await;
    let agent = (
        "User-Agent".to_string(),
        format!("Container Desktop {APP_VERSION}"),
    );

    harness
        .machine
        .forward(&payload(json!({ "url": "/info" })))
        .await
        .expect("the engine answered");

    let forwarded = harness.pinged().last().expect("a forward").headers.clone();
    assert!(forwarded.contains(&agent), "{forwarded:?}");
    // And the probe, for the reason the probe shares its headers at all: a connection declared up by a
    // question the forwarded traffic will not be asking is declared up by the wrong question.
    let ping = harness
        .pinged()
        .into_iter()
        .find(|request| request.path == "/_ping")
        .expect("the machine pinged");
    assert!(ping.headers.contains(&agent), "{:?}", ping.headers);
}

#[tokio::test]
async fn a_host_that_never_said_which_app_it_is_sends_no_agent_at_all() {
    // The other direction, and the reason it is not a default: `Container Desktop ` with the version
    // missing is a header that LOOKS answered and names nothing, which is worse in a log than no
    // header — the same rule `Host` already follows two lines above it.
    let mut harness = Harness::with_http(
        options(podman(), false),
        ConnectionContext {
            app_version: String::new(),
            ..linux(None)
        },
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        engine_answering(200, "{}"),
    );
    harness.connect(0).await;

    let ping = harness
        .pinged()
        .into_iter()
        .find(|request| request.path == "/_ping")
        .expect("the machine pinged");

    assert!(
        !ping.headers.iter().any(|(name, _)| name == "User-Agent"),
        "{:?}",
        ping.headers
    );
}

#[tokio::test]
async fn the_readiness_probe_asks_with_those_same_headers() {
    // Otherwise the connection is declared up by a question the forwarded traffic will not be asking.
    let harness = connected(engine_answering(200, "{}")).await;

    let ping = harness
        .pinged()
        .into_iter()
        .find(|request| request.path == "/_ping")
        .expect("the machine pinged");

    assert!(
        ping.headers
            .contains(&("Host".to_string(), "d".to_string()))
    );
}

#[tokio::test]
async fn a_header_the_caller_names_replaces_the_connections_default() {
    // `deepMerge({}, config.headers, request.headers)` — the request wins, and the match is
    // case-insensitive because HTTP field names are. A second `content-type` on the wire is two
    // answers to one question.
    let harness = connected(engine_answering(200, "{}")).await;

    harness
        .machine
        .forward(&payload(json!({
            "url": "/build",
            "headers": { "content-type": "application/x-tar", "X-Registry-Auth": "token" }
        })))
        .await
        .expect("the engine answered");

    let headers = harness.pinged().last().expect("a forward").headers.clone();
    assert!(
        headers.contains(&("Content-Type".to_string(), "application/x-tar".to_string())),
        "the caller's value under the default's spelling: {headers:?}"
    );
    assert_eq!(
        headers
            .iter()
            .filter(|(name, _)| name.eq_ignore_ascii_case("content-type"))
            .count(),
        1,
        "and only once: {headers:?}"
    );
    assert!(headers.contains(&("X-Registry-Auth".to_string(), "token".to_string())));
}

#[tokio::test]
async fn a_header_value_that_is_not_text_is_written_as_text_or_dropped() {
    // `plainHeaders` keeps strings, numbers and booleans and drops the rest. A header value is a
    // string on the wire, so an object has no honest spelling as one.
    let harness = connected(engine_answering(200, "{}")).await;

    harness
        .machine
        .forward(&payload(json!({
            "url": "/info",
            "headers": { "X-Count": 7, "X-Flag": true, "X-Object": { "a": 1 }, "X-Absent": null }
        })))
        .await
        .expect("the engine answered");

    let headers = harness.pinged().last().expect("a forward").headers.clone();
    assert!(headers.contains(&("X-Count".to_string(), "7".to_string())));
    assert!(headers.contains(&("X-Flag".to_string(), "true".to_string())));
    assert!(
        !headers.iter().any(|(name, _)| name == "X-Object"),
        "{headers:?}"
    );
    assert!(
        !headers.iter().any(|(name, _)| name == "X-Absent"),
        "{headers:?}"
    );
}

#[tokio::test]
async fn a_body_travels_as_json_unless_it_already_is_text() {
    let harness = connected(engine_answering(201, "{}")).await;

    harness
        .machine
        .forward(&payload(json!({
            "method": "POST",
            "url": "/containers/create",
            "data": { "Image": "alpine" }
        })))
        .await
        .expect("the engine answered");
    let object = harness.pinged().last().expect("a forward").body.clone();

    harness
        .machine
        .forward(&payload(json!({
            "method": "POST", "url": "/build", "data": "FROM alpine\n"
        })))
        .await
        .expect("the engine answered");
    let text = harness.pinged().last().expect("a forward").body.clone();

    assert_eq!(object, Some(r#"{"Image":"alpine"}"#.to_string()));
    assert_eq!(
        text,
        Some("FROM alpine\n".to_string()),
        "a string body is already what the engine wants — re-encoding it would quote it"
    );
}

#[tokio::test]
async fn a_deadline_the_caller_names_is_carried_and_a_zero_means_none() {
    // `0` is axios's "no timeout", which is what a stream is given. Turning it into a zero-length
    // deadline would abort every request instantly.
    let harness = connected(engine_answering(200, "{}")).await;

    harness
        .machine
        .forward(&payload(json!({ "url": "/info", "timeout": 9000 })))
        .await
        .expect("the engine answered");
    let bounded = harness.pinged().last().expect("a forward").timeout;

    harness
        .machine
        .forward(&payload(json!({ "url": "/info", "timeout": 0 })))
        .await
        .expect("the engine answered");
    let unbounded = harness.pinged().last().expect("a forward").timeout;

    assert_eq!(bounded, Some(std::time::Duration::from_millis(9000)));
    assert_eq!(unbounded, None);
}

#[tokio::test]
async fn an_engine_that_refuses_is_carried_rather_than_thrown() {
    // The original's rule and it is load-bearing: an adapter that branches on 404 must still see 404.
    // Turning a non-2xx into a refusal would replace the engine's own message with a code.
    let harness = connected(engine_answering(404, r#"{"message":"no such container"}"#)).await;

    let response = buffered(
        harness
            .machine
            .forward(&payload(json!({ "url": "/containers/nope/json" })))
            .await
            .expect("a 404 is an answer"),
    );

    assert!(!response.ok);
    assert_eq!(response.status, Some(404));
    assert_eq!(
        response.data,
        Some(json!({ "message": "no such container" })),
        "parsed, because the original's `response.data` is — axios parses by content type"
    );
    assert!(
        response.message.is_none(),
        "and no prose: the status and the engine's own body carry it"
    );
    assert!(!response.stream);
}

#[tokio::test]
async fn a_body_that_is_not_json_survives_as_text() {
    // `/_ping` answers `OK`, and an engine's plain-text error is not a parse failure. A client that
    // received a refusal for either would be told the engine was broken.
    let harness = connected(engine_answering(200, "OK")).await;

    let response = buffered(
        harness
            .machine
            .forward(&payload(json!({ "url": "/_ping?probe=1" })))
            .await
            .expect("the engine answered"),
    );

    assert_eq!(response.data, Some(Value::String("OK".to_string())));
}

#[tokio::test]
async fn a_query_this_core_cannot_build_is_refused_by_name() {
    // `params` is an axios shape — arrays, nested objects and its own percent-encoding — and half
    // serializing `filters` would send a request that looks right and asks something else. The query
    // belongs in `url`, which `HttpRequest::path` already says it carries.
    let harness = connected(engine_answering(200, "[]")).await;

    let refused = harness
        .machine
        .forward(&payload(json!({
            "url": "/containers/json", "params": { "all": true }
        })))
        .await
        .expect_err("a query this core cannot serialize is not sent");

    assert_eq!(refused.code, DiagnosticCode::ProxyRequestInvalid);
    assert_eq!(
        refused.params,
        Some(json!({ "field": "params" })),
        "the field, so a client knows what to move into the url"
    );
    assert!(
        !harness
            .pinged()
            .iter()
            .any(|request| request.path.starts_with("/containers")),
        "and nothing was sent"
    );
}

#[tokio::test]
async fn a_request_with_no_route_is_refused_by_name() {
    let harness = connected(engine_answering(200, "{}")).await;

    for req in [json!({ "method": "GET" }), json!({ "url": "" })] {
        let refused = harness
            .machine
            .forward(&payload(req.clone()))
            .await
            .expect_err("a forward with nowhere to go is not sent");

        assert_eq!(refused.code, DiagnosticCode::ProxyRequestInvalid);
        assert_eq!(refused.params, Some(json!({ "field": "url" })), "{req}");
    }
}

#[tokio::test]
async fn a_connection_with_no_resolved_address_asks_the_engine_nothing() {
    // The same refusal the readiness probe gives, because it is the same question: nothing ever
    // resolved an address, so there is nothing to dial and no reason to invent one.
    let harness = Harness::with_http(
        options(podman(), false),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        FakeHttp::scripted(|_| panic!("an unresolved connection must not reach the engine")),
    );

    let refused = harness
        .machine
        .forward(&payload(json!({ "url": "/info" })))
        .await
        .expect_err("nothing was ever resolved");

    assert_eq!(refused.code, DiagnosticCode::ApiSocketUnresolved);
}

/// The argv a resolved WSL bridge leaves on a connection — `wsl_args::dial_stdio_args`.
const DIAL_STDIO: [&str; 8] = [
    "--distribution",
    "Ubuntu",
    "--exec",
    "podman",
    "--url",
    "unix:///run/podman.sock",
    "system",
    "dial-stdio",
];

/// A connection carrying a bridge, in MANUAL mode so detection leaves its settings alone
/// (`machine.rs`: automatic mode re-derives `api.connection` and would wipe the command).
async fn bridged(http: FakeHttp) -> Harness {
    let mut connection = connection(
        "podman",
        "podman.native",
        "podman",
        "http://d",
        "mode.manual",
    );
    connection.settings.api.connection.dial_stdio_command =
        DIAL_STDIO.iter().map(|arg| arg.to_string()).collect();
    // Manual mode skips detection, so nothing fills the program in and the availability check refuses
    // before it ever reaches the API. A real manual connection carries the path the user configured.
    connection.settings.program.path = Some("/usr/bin/podman".to_string());
    connection.settings.program.version = Some("5.7.0".to_string());
    let mut harness = Harness::with_http(
        options(connection, false),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        http,
    );
    harness.connect(0).await;
    harness
}

/// A bridged connection forwards down the COMMAND, and needs no address at all.
///
/// **This is the whole reason the address kind exists.** The engine's socket is inside a WSL
/// distribution, on a filesystem no Windows process can open and at a path no `CreateFileW` accepts;
/// there is no forward that makes either false. So the address IS the command, and the bytes travel
/// over its stdin and stdout — which means a connection with an empty `uri` is perfectly reachable,
/// where without a bridge that same emptiness is honestly `API_SOCKET_UNRESOLVED`.
#[tokio::test]
async fn a_bridged_connection_forwards_over_its_command_and_needs_no_address() {
    let harness = bridged(engine_answering(200, "{}")).await;

    harness
        .machine
        .forward(&payload(json!({ "url": "/info" })))
        .await
        .expect("a bridged connection is reachable with no local address");

    assert_eq!(
        harness
            .pinged()
            .last()
            .expect("the forward reached the capability")
            .endpoint,
        cdc_runtime::capabilities::http::Endpoint::Stdio(
            DIAL_STDIO.iter().map(|arg| arg.to_string()).collect()
        )
    );
}

/// The readiness probe asks the same address the forward will — asserted for the BRIDGED case too.
///
/// The same rule `a_forward_reaches_the_same_address_the_readiness_probe_did` pins for a socket, and
/// it matters more here: the probe's presence check has no file to look for, so a probe that resolved
/// the endpoint differently would either refuse a healthy bridge or approve a dead one.
#[tokio::test]
async fn a_bridged_connection_is_probed_over_the_same_command() {
    let harness = bridged(engine_answering(200, "{}")).await;

    let probed = harness.pinged();
    let ping = probed
        .iter()
        .find(|request| request.path == "/_ping")
        .expect("the readiness probe ran");
    assert_eq!(
        ping.endpoint,
        cdc_runtime::capabilities::http::Endpoint::Stdio(
            DIAL_STDIO.iter().map(|arg| arg.to_string()).collect()
        )
    );
}

#[tokio::test]
async fn an_engine_that_cannot_be_reached_is_a_refusal_and_not_an_answer() {
    // The one case the original throws for. It is a different thing from a 404: nothing answered at
    // all, so there is no status to carry.
    let harness = connected(FakeHttp::scripted(|request| {
        if request.path == "/_ping" {
            return Ok(answered(200, "OK"));
        }
        Err(cdc_runtime::capabilities::http::HttpError::Unreachable {
            endpoint: request.endpoint.clone(),
            reason: "connection refused".to_string(),
        })
    }))
    .await;

    let refused = harness
        .machine
        .forward(&payload(json!({ "url": "/info" })))
        .await
        .expect_err("nothing answered");

    assert_eq!(refused.code, DiagnosticCode::ApiUnreachable);
}

#[tokio::test]
async fn a_stream_response_opens_a_stream_and_delivers_its_pieces_in_order() {
    // `responseType: "stream"` is how the original tells a log follow from a request, and it is the
    // whole reason the capability grew a second call: a body that arrives over time cannot come back
    // as a value.
    let harness = connected(engine_answering(200, "").delivering(&["first ", "second"])).await;

    let forwarded = harness
        .machine
        .forward(&payload(json!({
            "url": "/containers/web/logs?follow=1", "responseType": "stream"
        })))
        .await
        .expect("the engine answered");

    let ForwardedResponse::Stream(mut open) = forwarded else {
        panic!("a stream request must not come back buffered");
    };
    assert_eq!(open.status, 200);
    // What a failing assertion is allowed to see: the head, and never the body. Reading the body to
    // print it would consume the caller's stream, so a `Debug` that showed it would break the thing it
    // is describing.
    let printed = format!("{open:?}");
    assert!(printed.contains("HttpStreamOpen"), "{printed}");
    assert!(
        printed.contains("200"),
        "the head is what it prints: {printed}"
    );
    assert!(!printed.contains("first"), "and the body is not: {printed}");

    let mut delivered = Vec::new();
    while let Some(chunk) = open.body.next_chunk().await.expect("the stream is healthy") {
        assert!(
            delivered.len() <= MOST_CHUNKS,
            "the stream never ended: {delivered:?}"
        );
        delivered.push(chunk);
    }
    assert_eq!(delivered, vec![b"first ".to_vec(), b"second".to_vec()]);
}

/// The same connected podman, but this process is inside a flatpak sandbox.
async fn connected_in_flatpak() -> Harness {
    let mut context = linux(None);
    context.is_flatpak = true;
    let mut harness = Harness::with_http(
        options(podman(), false),
        context,
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        engine_answering(200, "[]"),
    );
    harness.connect(0).await;
    harness
}

#[tokio::test]
async fn a_sandboxed_connection_dials_the_hosts_spelling_of_its_socket() {
    // The dial-side half of the flatpak rule (`Api.clients.ts:getApiConfig`). The engine bound
    // `/run/podman.sock` in the host's namespace, and from in here that path is under the host prefix
    // — dialling the unprefixed one reaches nothing and reads as an engine that is down.
    let harness = connected_in_flatpak().await;

    harness
        .machine
        .forward(&payload(json!({ "url": "/_ping" })))
        .await
        .expect("the engine answered");

    let asked = harness.pinged();
    assert_eq!(
        asked
            .last()
            .expect("the forward reached the capability")
            .endpoint,
        cdc_runtime::capabilities::http::Endpoint::UnixSocket(format!(
            "/var/run/host{ENGINE_SOCKET}"
        ))
    );
    // **And the READINESS probe used the same spelling**, which is the property the shared resolver
    // exists for: a probe that agreed the engine was up at one address while the forward went to
    // another is this port's oldest class of defect.
    assert!(
        asked.iter().all(|it| it.endpoint
            == cdc_runtime::capabilities::http::Endpoint::UnixSocket(format!(
                "/var/run/host{ENGINE_SOCKET}"
            ))),
        "every request this connection made, not just the last: {asked:?}"
    );
}

#[tokio::test]
async fn a_sandboxed_lima_connection_dials_its_socket_unchanged() {
    // The other half of the conjunction, and the one a single-branch implementation gets wrong. LIMA
    // binds its forwarded socket under the user's own home, which a sandboxed process reaches at the
    // path it already has — prefixing it would compose an address in a namespace nothing binds. It is
    // one of the two hosts the oracle's list leaves out, here as `HostProfile::sandbox_maps_socket`.
    use cdc_runtime::runtimes::composition::HostProfile;
    use cdc_runtime::runtimes::profiles::shared::LimaProfile;

    assert!(!LimaProfile::PODMAN.sandbox_maps_socket());
    assert!(!LimaProfile::DOCKER.sandbox_maps_socket());
    // Against the leaves that DO map, so the assertion above is not simply true of everything.
    assert!(cdc_runtime::runtimes::profiles::podman::PodmanNativeProfile.sandbox_maps_socket());
    assert!(cdc_runtime::runtimes::profiles::shared::SshProfile::DOCKER.sandbox_maps_socket());
}
