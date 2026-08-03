//! The client half of the forwarding protocol, answering to `src/command_proxy.rs`.
//!
//! **What is asserted is the WHOLE payload and the whole response**, because this file's only job is a
//! translation: a field silently dropped here is a request that looks right and asks something else.
//! The far side of every one of these is `domain::machine::proxy`, and the two are read together.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use cdc_runtime::capabilities::http::{Endpoint, Http, HttpError, HttpRequest};
use cdc_runtime::command_proxy::{
    ForwardError, Forwarded, ForwardedHttp, ForwardedStream, Forwarder,
};
use cdc_runtime::domain::types::command_proxy_protocol::{
    CommandProxyRequestPayload, CommandProxyResponse, CommandProxyStreamEvent,
    CommandProxyStreamHandle, StreamEventType,
};
use cdc_runtime::domain::types::diagnostic::{
    DiagnosticCode, DiagnosticSeverity, ReportedDiagnostic,
};
use serde_json::{Value, json};
use tokio::sync::mpsc;

const CONNECTION: &str = "host.default.podman.native";

/// A forwarder that records what it was asked to carry and answers what a test told it to.
struct FakeForwarder {
    answer: Mutex<Option<Result<Forwarded, ForwardError>>>,
    /// Every payload, in order — what an assertion about the request reads.
    carried: Mutex<Vec<CommandProxyRequestPayload>>,
    /// Every stream a `Drop` asked to be torn down.
    destroyed: Mutex<Vec<String>>,
}

impl FakeForwarder {
    fn answering(answer: Result<Forwarded, ForwardError>) -> Arc<Self> {
        Arc::new(Self {
            answer: Mutex::new(Some(answer)),
            carried: Mutex::new(Vec::new()),
            destroyed: Mutex::new(Vec::new()),
        })
    }

    fn buffered(response: CommandProxyResponse) -> Arc<Self> {
        Self::answering(Ok(Forwarded::Buffered(response)))
    }

    fn carried(&self) -> CommandProxyRequestPayload {
        self.carried
            .lock()
            .expect("carried")
            .first()
            .cloned()
            .expect("exactly one payload was forwarded")
    }

    fn destroyed(&self) -> Vec<String> {
        self.destroyed.lock().expect("destroyed").clone()
    }
}

#[async_trait]
impl Forwarder for FakeForwarder {
    async fn forward(
        &self,
        payload: &CommandProxyRequestPayload,
    ) -> Result<Forwarded, ForwardError> {
        self.carried.lock().expect("carried").push(payload.clone());
        self.answer
            .lock()
            .expect("answer")
            .take()
            .unwrap_or(Err(ForwardError::Disconnected))
    }

    fn destroy(&self, stream_id: &str) {
        self.destroyed
            .lock()
            .expect("destroyed")
            .push(stream_id.to_string());
    }
}

fn ok(data: Value) -> CommandProxyResponse {
    CommandProxyResponse {
        data: Some(data),
        headers: Some(
            json!({ "Content-Type": "application/json" })
                .as_object()
                .cloned()
                .expect("an object"),
        ),
        message: None,
        ok: true,
        status: Some(200),
        status_text: Some("OK".to_string()),
        stream: false,
    }
}

fn streamed(stream_id: &str) -> (Forwarded, mpsc::Sender<CommandProxyStreamEvent>) {
    let (chunks, receiver) = mpsc::channel(8);
    (
        Forwarded::Stream(ForwardedStream {
            handle: CommandProxyStreamHandle {
                headers: None,
                status: Some(200),
                stream: true,
                stream_id: stream_id.to_string(),
            },
            chunks: receiver,
        }),
        chunks,
    )
}

fn chunk(
    stream_id: &str,
    type_: StreamEventType,
    payload: Option<Value>,
) -> CommandProxyStreamEvent {
    CommandProxyStreamEvent {
        payload,
        stream_id: stream_id.to_string(),
        type_,
    }
}

fn carried_bytes(bytes: &[u8]) -> Value {
    Value::Array(bytes.iter().map(|byte| (*byte).into()).collect())
}

fn asking(path: &str) -> HttpRequest {
    HttpRequest {
        endpoint: Endpoint::Connection(CONNECTION.to_string()),
        method: "GET".to_string(),
        path: path.to_string(),
        headers: Vec::new(),
        body: None,
        timeout: None,
    }
}

#[tokio::test]
async fn the_whole_request_travels_in_the_payload_and_the_query_is_in_the_url() {
    let forwarder = FakeForwarder::buffered(ok(json!([])));
    let http = ForwardedHttp::new(Arc::clone(&forwarder) as Arc<dyn Forwarder>);
    let mut request = asking("/containers/json?all=true");
    request.method = "POST".to_string();
    request.headers = vec![("Accept".to_string(), "application/json".to_string())];
    request.body = Some(r#"{"image":"httpd"}"#.to_string());
    request.timeout = Some(Duration::from_millis(60_000));

    http.request(&request).await.expect("forwarded");

    let payload = forwarder.carried();
    assert_eq!(
        payload.connection.as_ref().and_then(|it| it.get("id")),
        Some(&json!(CONNECTION)),
        "the routing key, and the only thing this port's server reads off the connection"
    );
    assert_eq!(
        payload.connection.map(|it| it.len()),
        Some(1),
        "nothing else is sent: `pickConnection` also copies host and api settings, and the machine \
         resolves both itself"
    );
    assert_eq!(
        serde_json::to_value(&payload.req).expect("the request"),
        json!({
            "method": "POST",
            "url": "/containers/json?all=true",
            "headers": { "Accept": "application/json" },
            "data": r#"{"image":"httpd"}"#,
            "timeout": 60_000u64,
        }),
        "the WHOLE request, and `params` is never one of the keys — the far side refuses that outright"
    );
}

#[tokio::test]
async fn a_body_travels_as_the_text_it_already_is() {
    let forwarder = FakeForwarder::buffered(ok(json!({})));
    let http = ForwardedHttp::new(Arc::clone(&forwarder) as Arc<dyn Forwarder>);
    let mut request = asking("/containers/create");
    request.body = Some(r#"{"image":"httpd"}"#.to_string());

    http.request(&request).await.expect("forwarded");

    assert_eq!(
        forwarder.carried().req.get("data"),
        Some(&json!(r#"{"image":"httpd"}"#)),
        "a STRING, not a parsed object: the body is already serialized and re-serializing it would \
         put different bytes on the engine's socket"
    );
}

#[tokio::test]
async fn a_stream_asks_for_one_and_a_whole_read_does_not() {
    let forwarder = FakeForwarder::answering(Ok(streamed("cps-1").0));
    let http = ForwardedHttp::new(Arc::clone(&forwarder) as Arc<dyn Forwarder>);

    http.stream(&asking("/containers/x/logs"))
        .await
        .expect("opened");
    assert_eq!(
        forwarder.carried().req.get("responseType"),
        Some(&json!("stream")),
        "which is the key `machine::proxy` branches on"
    );

    let whole = FakeForwarder::buffered(ok(json!([])));
    ForwardedHttp::new(Arc::clone(&whole) as Arc<dyn Forwarder>)
        .request(&asking("/containers/json"))
        .await
        .expect("forwarded");
    assert!(
        !whole.carried().req.contains_key("responseType"),
        "a whole read must not ask for a stream, or every list would come back as a handle"
    );
}

#[tokio::test]
async fn a_non_2xx_is_carried_with_the_engines_own_body_rather_than_refused() {
    let forwarder = FakeForwarder::buffered(CommandProxyResponse {
        data: Some(json!({ "message": "This node is not a swarm manager." })),
        headers: None,
        message: None,
        ok: false,
        status: Some(503),
        status_text: Some("Service Unavailable".to_string()),
        stream: false,
    });
    let http = ForwardedHttp::new(forwarder as Arc<dyn Forwarder>);

    let response = http
        .request(&asking("/secrets/json"))
        .await
        .expect("a refusal is an ANSWER, not a transport failure");

    assert_eq!(response.status, 503);
    assert_eq!(response.status_text, "Service Unavailable");
    assert!(!response.ok(), "and an adapter is what decides what to do");
    assert!(
        response.body.contains("not a swarm manager"),
        "the engine's own sentence survives, which is the whole reason a refusal is not an empty \
         list: {}",
        response.body
    );
}

#[tokio::test]
async fn a_json_body_round_trips_and_a_plain_text_one_survives_as_itself() {
    let json_body = FakeForwarder::buffered(ok(json!([{ "Id": "abc" }])));
    let read = ForwardedHttp::new(json_body as Arc<dyn Forwarder>)
        .request(&asking("/containers/json"))
        .await
        .expect("forwarded");
    assert_eq!(
        serde_json::from_str::<Value>(&read.body).expect("it parses again"),
        json!([{ "Id": "abc" }]),
        "the far side parsed it and this re-serializes it, so an adapter's own parse still works"
    );

    let text = FakeForwarder::buffered(ok(json!("OK")));
    let read = ForwardedHttp::new(text as Arc<dyn Forwarder>)
        .request(&asking("/_ping"))
        .await
        .expect("forwarded");
    assert_eq!(
        read.body, "OK",
        "`/_ping` answers text and it arrives as text"
    );
}

#[tokio::test]
async fn a_bare_json_string_body_is_indistinguishable_from_plain_text() {
    // The lossy corner, pinned rather than left to be discovered: the far side parses `"OK"` to
    // `Value::String("OK")`, which is exactly what a plain-text `OK` becomes. Every engine route an
    // adapter reads answers an object or an array, so nothing in this port can tell the difference and
    // nothing needs to — but a future caller reading a bare JSON string would get it unquoted.
    let quoted = FakeForwarder::buffered(ok(json!("OK")));
    let read = ForwardedHttp::new(quoted as Arc<dyn Forwarder>)
        .request(&asking("/_ping"))
        .await
        .expect("forwarded");
    assert_eq!(read.body, "OK");
    assert_ne!(
        read.body, "\"OK\"",
        "the quotes are gone, and that is the documented consequence rather than a defect to fix here"
    );
}

#[tokio::test]
async fn a_response_header_arrives_as_an_ordered_pair() {
    let forwarder = FakeForwarder::buffered(ok(json!({})));
    let read = ForwardedHttp::new(forwarder as Arc<dyn Forwarder>)
        .request(&asking("/containers/json"))
        .await
        .expect("forwarded");
    assert_eq!(
        read.headers,
        vec![("Content-Type".to_string(), "application/json".to_string())],
        "the far side writes strings, and they come back as the pairs HTTP has"
    );
}

#[tokio::test]
async fn a_header_that_is_not_a_string_is_coerced_and_one_that_cannot_be_is_dropped() {
    // The far side writes strings, so these arms exist for a peer that writes what `plainHeaders`
    // coerces. Asserted rather than assumed: a reader that dropped a numeric `Content-Length` would
    // silently lose the one header a body's length is carried in.
    let forwarder = FakeForwarder::buffered(CommandProxyResponse {
        data: None,
        headers: Some(
            json!({
                "Content-Length": 12,
                "X-Cached": true,
                "X-Structured": { "not": "a header value" },
            })
            .as_object()
            .cloned()
            .expect("an object"),
        ),
        message: None,
        ok: true,
        status: Some(200),
        status_text: Some("OK".to_string()),
        stream: false,
    });
    let read = ForwardedHttp::new(forwarder as Arc<dyn Forwarder>)
        .request(&asking("/containers/json"))
        .await
        .expect("forwarded");

    assert_eq!(
        read.headers,
        vec![
            ("Content-Length".to_string(), "12".to_string()),
            ("X-Cached".to_string(), "true".to_string()),
        ],
        "a number and a boolean become text, and an object has no honest spelling as a header value"
    );
}

#[tokio::test]
async fn only_a_connection_is_a_route_and_every_other_address_is_refused() {
    let forwarder = FakeForwarder::buffered(ok(json!({})));
    let http = ForwardedHttp::new(Arc::clone(&forwarder) as Arc<dyn Forwarder>);
    for endpoint in [
        Endpoint::UnixSocket("/run/podman.sock".to_string()),
        Endpoint::NamedPipe(r"\\.\pipe\podman".to_string()),
        Endpoint::Tcp("127.0.0.1:2375".to_string()),
        Endpoint::Stdio(vec!["podman".to_string()]),
        // An empty id is a payload the far side would refuse anyway, and refusing it here says the
        // same thing without a round trip.
        Endpoint::Connection(String::new()),
    ] {
        let mut request = asking("/containers/json");
        request.endpoint = endpoint.clone();
        let refusal = http.request(&request).await.expect_err("refused");
        assert!(
            matches!(&refusal, HttpError::Unsupported(refused) if *refused == endpoint),
            "dialling a local address here is the thing the forwarding protocol exists to avoid: \
             {refusal}"
        );
    }
    assert!(
        forwarder.carried.lock().expect("carried").is_empty(),
        "and nothing was sent, so a refusal costs no round trip"
    );
}

#[tokio::test]
async fn a_forwarded_stream_delivers_bytes_and_ends_on_its_terminal_frame() {
    let (answer, chunks) = streamed("cps-1");
    let forwarder = FakeForwarder::answering(Ok(answer));
    let http = ForwardedHttp::new(Arc::clone(&forwarder) as Arc<dyn Forwarder>);
    let mut open = http
        .stream(&asking("/containers/x/logs"))
        .await
        .expect("opened");

    assert_eq!(open.status, 200);
    assert_eq!(
        open.status_text, "",
        "a stream handle carries no reason phrase and the original sends the empty one"
    );

    // The header's length byte is 0xac, which is not valid UTF-8 — a carrier that decoded would have
    // made three bytes of it.
    let framed = [0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xac];
    chunks
        .send(chunk(
            "cps-1",
            StreamEventType::Data,
            Some(carried_bytes(&framed)),
        ))
        .await
        .expect("delivered");
    chunks
        .send(chunk("cps-1", StreamEventType::End, None))
        .await
        .expect("ended");

    assert_eq!(
        open.body.next_chunk().await.expect("a chunk"),
        Some(framed.to_vec()),
        "byte for byte"
    );
    assert_eq!(
        open.body.next_chunk().await.expect("the end"),
        None,
        "and `end` is the end"
    );
    drop(open);
    assert!(
        forwarder.destroyed().is_empty(),
        "a stream the far side already ended is not asked to be torn down again — it destroyed it \
         itself on the terminal frame"
    );
}

#[tokio::test]
async fn an_empty_chunk_is_waited_through_rather_than_read_as_an_end() {
    let (answer, chunks) = streamed("cps-1");
    let forwarder = FakeForwarder::answering(Ok(answer));
    let http = ForwardedHttp::new(forwarder as Arc<dyn Forwarder>);
    let mut open = http.stream(&asking("/events")).await.expect("opened");

    chunks
        .send(chunk(
            "cps-1",
            StreamEventType::Data,
            Some(carried_bytes(&[])),
        ))
        .await
        .expect("delivered");
    chunks
        .send(chunk(
            "cps-1",
            StreamEventType::Data,
            Some(carried_bytes(b"x")),
        ))
        .await
        .expect("delivered");

    assert_eq!(
        open.body.next_chunk().await.expect("a chunk"),
        Some(b"x".to_vec()),
        "`Ok(Some)` carries at least one byte, so an empty payload cannot be answered as one — and a \
         whole-response read that took it would spin rather than wait"
    );
}

#[tokio::test]
async fn a_stream_that_dies_with_its_session_is_told_apart_from_one_that_finished() {
    let (answer, chunks) = streamed("cps-1");
    let forwarder = FakeForwarder::answering(Ok(answer));
    let http = ForwardedHttp::new(Arc::clone(&forwarder) as Arc<dyn Forwarder>);
    let mut open = http
        .stream(&asking("/containers/x/logs"))
        .await
        .expect("opened");

    drop(chunks);

    let failure =
        open.body.next_chunk().await.expect_err(
            "a truncated log reported as a complete one is the worst reading available",
        );
    assert!(
        matches!(failure, HttpError::Unreachable { .. }),
        "and it names the connection it came down: {failure}"
    );
    drop(open);
    assert_eq!(
        forwarder.destroyed(),
        Vec::<String>::new(),
        "the session is gone, so it has already forgotten the stream"
    );
}

#[tokio::test]
async fn an_error_frame_ends_the_stream_and_carries_the_code_the_far_side_sent() {
    let (answer, chunks) = streamed("cps-1");
    let forwarder = FakeForwarder::answering(Ok(answer));
    let http = ForwardedHttp::new(forwarder as Arc<dyn Forwarder>);
    let mut open = http
        .stream(&asking("/containers/x/logs"))
        .await
        .expect("opened");

    chunks
        .send(chunk(
            "cps-1",
            StreamEventType::Error,
            Some(json!({ "code": DiagnosticCode::ApiUnreachable })),
        ))
        .await
        .expect("delivered");

    let failure = open.body.next_chunk().await.expect_err("it failed");
    assert!(
        failure.to_string().contains("API_UNREACHABLE"),
        "the code travels rather than being replaced with a sentence of this client's own: {failure}"
    );
}

#[tokio::test]
async fn a_stream_abandoned_before_it_ended_is_torn_down_on_the_far_side() {
    let (answer, _chunks) = streamed("cps-7");
    let forwarder = FakeForwarder::answering(Ok(answer));
    let http = ForwardedHttp::new(Arc::clone(&forwarder) as Arc<dyn Forwarder>);

    let open = http
        .stream(&asking("/containers/x/logs"))
        .await
        .expect("opened");
    drop(open);

    assert_eq!(
        forwarder.destroyed(),
        vec!["cps-7".to_string()],
        "a client that navigates away from a log view leaks an engine connection otherwise"
    );
}

#[tokio::test]
async fn a_whole_read_answered_with_a_stream_tears_it_down_rather_than_leaking_it() {
    let (answer, _chunks) = streamed("cps-3");
    let forwarder = FakeForwarder::answering(Ok(answer));
    let http = ForwardedHttp::new(Arc::clone(&forwarder) as Arc<dyn Forwarder>);

    let refusal = http
        .request(&asking("/containers/json"))
        .await
        .expect_err("a feed is not a whole answer");
    assert!(matches!(refusal, HttpError::Malformed { .. }), "{refusal}");
    assert_eq!(
        forwarder.destroyed(),
        vec!["cps-3".to_string()],
        "the far side is holding an engine connection for it, and nothing else will ever ask"
    );
}

#[tokio::test]
async fn a_stream_answered_with_a_whole_response_is_a_protocol_disagreement() {
    let forwarder = FakeForwarder::buffered(ok(json!([])));
    let refusal = ForwardedHttp::new(forwarder as Arc<dyn Forwarder>)
        .stream(&asking("/containers/x/logs"))
        .await
        .expect_err("a far side that ignored responseType");
    assert!(matches!(refusal, HttpError::Malformed { .. }), "{refusal}");
}

#[tokio::test]
async fn a_forwarder_that_cannot_reach_its_server_reads_as_an_engine_that_cannot_be_reached() {
    let gone = FakeForwarder::answering(Err(ForwardError::Disconnected));
    let failure = ForwardedHttp::new(gone as Arc<dyn Forwarder>)
        .request(&asking("/containers/json"))
        .await
        .expect_err("nothing carried it");
    assert!(
        matches!(&failure, HttpError::Unreachable { endpoint, .. }
            if *endpoint == Endpoint::Connection(CONNECTION.to_string())),
        "wider than the name and deliberately so — `machine::proxy::unreachable` makes the same call \
         for the same reason: {failure}"
    );

    let refused = FakeForwarder::answering(Err(ForwardError::Refused {
        diagnostic: Box::new(ReportedDiagnostic {
            code: DiagnosticCode::ProxyRequestInvalid,
            params: serde_json::Map::new(),
            severity: DiagnosticSeverity::Err,
        }),
    }));
    let failure = ForwardedHttp::new(refused as Arc<dyn Forwarder>)
        .request(&asking("/containers/json"))
        .await
        .expect_err("the server said no");
    assert!(
        failure.to_string().contains("PROXY_REQUEST_INVALID"),
        "and which refusal it was survives into the reason: {failure}"
    );
}

#[tokio::test]
async fn a_reply_with_no_status_is_never_read_as_success() {
    let forwarder = FakeForwarder::buffered(CommandProxyResponse {
        data: None,
        headers: None,
        message: None,
        ok: true,
        status: None,
        status_text: None,
        stream: false,
    });
    let read = ForwardedHttp::new(forwarder as Arc<dyn Forwarder>)
        .request(&asking("/containers/json"))
        .await
        .expect("it answered");
    assert_eq!(read.status, 0);
    assert!(
        !read.ok(),
        "`machine::proxy::buffered` always fills the status, so an absent one is a far side this \
         port did not write — and reading it as 200 would hand an adapter an empty body to parse"
    );
    assert!(read.body.is_empty());
}
