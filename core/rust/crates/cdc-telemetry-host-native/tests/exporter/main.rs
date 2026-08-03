//! Where the telemetry actually goes.
//!
//! The point of this file is the last test: a real OTLP exporter, a real HTTP POST, and the span name
//! found in the bytes that left the process. Everything above it is the configuration rule, which is
//! what silently sends spans to the wrong place — a 404 from a collector is logged by the SDK and
//! dropped, so a wrong endpoint looks exactly like a working one.

// `Config::resolve` is the precedence rule and is asserted here; reading the three variables out of
// the real process environment is its own file, because it needs a process of its own.
mod environment;

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Duration;

use cdc_telemetry::trace::{Attribute, AttributeValue, SpanRecord, SpanStatus};
use cdc_telemetry_host_native::exporter::{
    Config, DEFAULT_ENDPOINT, DEFAULT_SERVICE_NAME, Pipeline,
};
use cdc_telemetry_host_native::sink::OtelSink;
use tracing_subscriber::layer::SubscriberExt;

/// A collector nothing is listening on. Port 1 is privileged and unbound, so the connection is refused
/// immediately rather than after a timeout.
const DEAD_COLLECTOR: &str = "http://127.0.0.1:1";

fn span(name: &str) -> SpanRecord {
    SpanRecord {
        name: name.to_string(),
        status: SpanStatus::Ok,
        started_ms: 1_700_000_000_000,
        ended_ms: 1_700_000_002_500,
        attributes: vec![Attribute::new(
            "cdc.connection.id",
            AttributeValue::Text("host.default.podman.native".to_string()),
        )],
    }
}

fn pipeline_to(endpoint: &str) -> Pipeline {
    Pipeline::build(Config {
        endpoint: endpoint.to_string(),
        service_name: "cdc-exporter-test".to_string(),
    })
    .expect("the exporter builds")
}

#[test]
fn the_traces_specific_endpoint_wins_over_the_general_one() {
    // The OTLP precedence rule. Getting it backwards points every span at the wrong collector on any
    // machine that sets both, which is any machine also exporting metrics or logs.
    let config = Config::resolve(
        Some("http://traces:4318".to_string()),
        Some("http://general:4318".to_string()),
        None,
    );

    assert_eq!(config.endpoint, "http://traces:4318");
}

#[test]
fn a_trailing_slash_does_not_become_a_double_slash_in_the_path() {
    // `http://host:4318//v1/traces` is a 404 on most collectors, and a 404 is dropped silently.
    let config = Config::resolve(None, Some("http://collector:4318/".to_string()), None);

    assert_eq!(config.traces_url(), "http://collector:4318/v1/traces");
}

#[test]
fn an_unset_or_empty_environment_falls_back_to_the_local_collector() {
    for endpoint in [None, Some(String::new())] {
        let config = Config::resolve(None, endpoint.clone(), None);

        assert_eq!(config.endpoint, DEFAULT_ENDPOINT, "for {endpoint:?}");
        assert_eq!(config.service_name, DEFAULT_SERVICE_NAME);
    }
}

#[test]
fn the_service_name_is_named_rather_than_left_to_the_sdk() {
    // The SDK's own default is `unknown_service`, which makes a dashboard useless.
    assert_eq!(Config::default().service_name, DEFAULT_SERVICE_NAME);
    assert_eq!(
        Config::resolve(None, None, Some("mine".to_string())).service_name,
        "mine"
    );
}

#[test]
fn an_endpoint_that_is_not_a_url_fails_the_build_and_names_itself() {
    // The one failure mode worth a hard error rather than a dropped span: the collector being DOWN must
    // not stop a connection from being made, but an endpoint that can never work is a misconfiguration,
    // and the message has to carry the URL or nobody can see what is wrong with it.
    // Matched rather than `expect_err`: a live pipeline is a running exporter thread, so it is
    // deliberately not `Debug` and cannot be printed by a failing assertion.
    let error = match Pipeline::build(Config {
        endpoint: "not a url".to_string(),
        service_name: "cdc-exporter-test".to_string(),
    }) {
        Ok(_) => panic!("a malformed endpoint must not build an exporter"),
        Err(error) => error,
    };

    let message = format!("{error}");
    assert!(message.contains("not a url/v1/traces"), "got {message}");
}

#[test]
fn a_collector_that_is_not_running_still_builds_because_it_may_come_up_later() {
    // The other half of the rule above, and the important half: telemetry must never be a reason a
    // connection cannot be brought up.
    let pipeline = pipeline_to(DEAD_COLLECTOR);

    assert_eq!(pipeline.config().endpoint, DEAD_COLLECTOR);
}

/// One-shot collector: accept a single POST, hand the bytes back, answer 200.
///
/// Deliberately a real socket rather than a mocked client. The claim under test is "spans leave this
/// process", and only something outside the process can witness that.
fn one_shot_collector() -> (String, mpsc::Receiver<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
    let endpoint = format!("http://{}", listener.local_addr().expect("bound address"));
    let (sender, receiver) = mpsc::channel();

    std::thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };
        let mut received = Vec::new();
        let mut buffer = [0_u8; 8192];
        // Read until the body is in: the exporter sends Content-Length, so the request ends with it
        // and a read that returns 0 means the peer is done.
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    received.extend_from_slice(&buffer[..read]);
                    if body_is_complete(&received) {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = stream.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/x-protobuf\r\nContent-Length: 0\r\n\r\n",
        );
        let _ = stream.flush();
        let _ = sender.send(received);
    });

    (endpoint, receiver)
}

/// Whether the headers name a length and that many body bytes have arrived.
fn body_is_complete(received: &[u8]) -> bool {
    let text = String::from_utf8_lossy(received);
    let Some((headers, body)) = text.split_once("\r\n\r\n") else {
        return false;
    };
    let Some(length) = headers.lines().find_map(|line| {
        line.to_ascii_lowercase()
            .strip_prefix("content-length:")?
            .trim()
            .parse::<usize>()
            .ok()
    }) else {
        return false;
    };
    body.len() >= length
}

#[test]
fn a_span_really_is_posted_to_the_collector_as_otlp() {
    let (endpoint, received) = one_shot_collector();
    let config = Config {
        endpoint: endpoint.clone(),
        service_name: "cdc-exporter-test".to_string(),
    };

    let pipeline = Pipeline::build(config).expect("the exporter builds");
    let sink = OtelSink::new(pipeline.tracer());
    sink.export(&SpanRecord {
        name: "cdc.connection.start".to_string(),
        status: SpanStatus::Ok,
        started_ms: 1_700_000_000_000,
        ended_ms: 1_700_000_002_500,
        attributes: vec![Attribute::new(
            "cdc.connection.id",
            AttributeValue::Text("host.default.podman.native".to_string()),
        )],
    });
    pipeline.flush().expect("the batch is pushed");

    let request = received
        .recv_timeout(Duration::from_secs(10))
        .expect("the collector received a request");
    let text = String::from_utf8_lossy(&request);
    assert!(
        text.starts_with("POST /v1/traces "),
        "wrong route: {}",
        text.lines().next().unwrap_or_default()
    );
    assert!(
        text.contains("content-type: application/x-protobuf")
            || text.contains("Content-Type: application/x-protobuf"),
        "wrong encoding: {text:?}"
    );
    // The span name and the service travel as length-delimited strings inside the protobuf, so they
    // are findable in the raw bytes — which is the whole point: this is what left the machine.
    assert!(
        text.contains("cdc.connection.start"),
        "the span itself is not in the payload"
    );
    assert!(
        text.contains("cdc-exporter-test"),
        "the service name is not in the payload"
    );
    assert!(
        text.contains("host.default.podman.native"),
        "the allowlisted attribute is not in the payload"
    );
}

#[test]
fn dropping_the_pipeline_flushes_what_was_still_queued() {
    // The last-chance flush, and the reason it matters: a batching exporter drops its queue when the
    // process exits, and the span still in that queue is the one that explains the failure somebody is
    // investigating. Note there is NO explicit flush here — the drop is the whole test.
    //
    // This is a claim about `SdkTracerProvider`, which shuts itself down when dropped. Pinned here
    // rather than assumed, because an SDK that stopped doing it would lose exactly that span, silently —
    // and it is why `Pipeline` needs no `Drop` impl of its own.
    let (endpoint, received) = one_shot_collector();

    {
        let pipeline = pipeline_to(&endpoint);
        OtelSink::new(pipeline.tracer()).export(&span("cdc.connection.disconnect"));
    }

    let request = received
        .recv_timeout(Duration::from_secs(10))
        .expect("dropping the pipeline must push the queue");
    assert!(
        String::from_utf8_lossy(&request).contains("cdc.connection.disconnect"),
        "the queued span was lost on drop"
    );
}

#[test]
fn a_tracing_span_reaches_this_pipeline_rather_than_a_provider_of_its_own() {
    // `provider()` exists for exactly this composition — `layer::build` takes a provider — so the claim
    // to check is that the bridge exports through THIS pipeline. A layer built over any other provider
    // sends the span somewhere nobody is reading, which is indistinguishable from working.
    let (endpoint, received) = one_shot_collector();
    let pipeline = pipeline_to(&endpoint);

    let subscriber = tracing_subscriber::Registry::default()
        .with(cdc_telemetry_host_native::layer::build(pipeline.provider()));
    tracing::subscriber::with_default(subscriber, || {
        let span = tracing::info_span!("cdc.connection.connect");
        let _entered = span.enter();
    });
    pipeline.flush().expect("the batch is pushed");

    let request = received
        .recv_timeout(Duration::from_secs(10))
        .expect("the collector received a request");
    assert!(
        String::from_utf8_lossy(&request).contains("cdc.connection.connect"),
        "the tracing span did not export through this pipeline"
    );
}

#[test]
fn flushing_reports_a_batch_the_collector_never_took() {
    // A silent flush is how "the failing connection emitted no trace" happens: the SDK logs the network
    // error and drops the batch, so the only caller who can act on it is the one holding this result.
    let pipeline = pipeline_to(DEAD_COLLECTOR);
    OtelSink::new(pipeline.tracer()).export(&span("cdc.connection.connect"));

    let error = pipeline
        .flush()
        .expect_err("a refused connection is not a successful flush");

    assert!(
        format!("{error}").contains("flushing traces failed"),
        "got {error}"
    );
}

#[test]
fn shutting_down_reports_the_lost_batch_too_because_that_is_the_whole_point_of_it() {
    // The SDK's own shutdown answers `Ok` for a batch that never arrived — it reports that the pipeline
    // stopped, not that the queue was delivered. So `shutdown` flushes first, and a caller on the way
    // out learns what `Drop` could never have told it.
    let pipeline = pipeline_to(DEAD_COLLECTOR);
    OtelSink::new(pipeline.tracer()).export(&span("cdc.connection.connect"));

    let error = pipeline
        .shutdown()
        .expect_err("a shutdown that lost the last batch is not a clean one");

    assert!(
        format!("{error}").contains("flushing traces failed"),
        "got {error}"
    );
}

#[test]
fn shutting_down_with_nothing_queued_succeeds_even_with_no_collector_at_all() {
    // The other half: telemetry must never become a reason a process cannot exit, and a collector that
    // was never contacted is not a failure.
    pipeline_to(DEAD_COLLECTOR)
        .shutdown()
        .expect("an empty pipeline shuts down cleanly");
}

#[test]
fn a_pipeline_whose_provider_somebody_else_already_stopped_answers_rather_than_panics() {
    // `provider()` hands out a clonable handle — `layer::build` takes one — so "already stopped" is a
    // real lifecycle rather than a contrivance, and it is the state in which the SDK's stop path
    // unwraps a mutex and joins a thread. It must come back as a refusal, not as a panic on the way
    // out of a process.
    let pipeline = pipeline_to(DEAD_COLLECTOR);
    pipeline
        .provider()
        .clone()
        .shutdown()
        .expect("the twin stops it");

    let error = pipeline
        .shutdown()
        .expect_err("a pipeline that cannot flush has not shut down cleanly");

    assert!(
        format!("{error}").contains("flushing traces failed"),
        "got {error}"
    );
}
