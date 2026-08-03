//! The mapping: one `SpanRecord` in, one OpenTelemetry span out.
//!
//! Asserted against a real `SdkTracerProvider` with an in-memory exporter, so what is checked is the
//! span that WOULD have been serialised — its status, its timestamps and its typed attribute values —
//! rather than the sink's own bookkeeping. `tests/exporter.rs` covers the other end, where the bytes
//! actually leave the process.

use std::time::{Duration, UNIX_EPOCH};

use cdc_telemetry::attributes::attr;
use cdc_telemetry::privacy::Dropped;
use cdc_telemetry::trace::{Attribute, AttributeValue, SpanRecord, SpanStatus, TraceSink};
use cdc_telemetry_host_native::sink::OtelSink;
use opentelemetry::Value;
use opentelemetry::trace::{Status, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};

const STARTED_MS: u64 = 1_700_000_000_000;
const ENDED_MS: u64 = 1_700_000_002_500;

/// A provider that keeps its spans in memory, plus the sink over it.
///
/// `with_simple_exporter` rather than a batch one: a test that has to wait for a batch interval is a
/// test that flakes on a loaded machine.
fn recording_sink() -> (InMemorySpanExporter, OtelSink) {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let sink = OtelSink::new(provider.tracer("cdc-sink-test"));
    (exporter, sink)
}

fn only_span(exporter: &InMemorySpanExporter) -> SpanData {
    let mut spans = exporter
        .get_finished_spans()
        .expect("the spans are readable");
    assert_eq!(spans.len(), 1, "exactly one span was exported");
    spans.remove(0)
}

fn record(status: SpanStatus, attributes: Vec<Attribute>) -> SpanRecord {
    SpanRecord {
        name: "cdc.connection.connect".to_string(),
        status,
        started_ms: STARTED_MS,
        ended_ms: ENDED_MS,
        attributes,
    }
}

fn attribute_of(span: &SpanData, key: &str) -> Value {
    span.attributes
        .iter()
        .find(|pair| pair.key.as_str() == key)
        .unwrap_or_else(|| panic!("{key} is not on the span: {:?}", span.attributes))
        .value
        .clone()
}

#[test]
fn the_records_own_timestamps_are_what_the_span_carries() {
    // The reason this test exists: the span is built AFTER the work finished, so a span stamped "now"
    // on both ends reports every bring-up as instantaneous — and `SpanBuilder` has no end time to set,
    // only a start, which is what makes this easy to get wrong.
    let (exporter, sink) = recording_sink();

    sink.record(&record(SpanStatus::Ok, Vec::new()));

    let span = only_span(&exporter);
    assert_eq!(
        span.start_time,
        UNIX_EPOCH + Duration::from_millis(STARTED_MS)
    );
    assert_eq!(span.end_time, UNIX_EPOCH + Duration::from_millis(ENDED_MS));
    assert_eq!(
        span.end_time
            .duration_since(span.start_time)
            .expect("the span does not end before it starts"),
        Duration::from_millis(2_500)
    );
    assert_eq!(span.name, "cdc.connection.connect");
}

#[test]
fn each_status_maps_to_its_own_and_an_unset_one_is_not_success() {
    // Three states, not two. An in-flight span is `Unset`, and reporting that as `Ok` is how a
    // connection that crashed mid-bring-up reads as healthy.
    for (status, expected) in [
        (SpanStatus::Unset, Status::Unset),
        (SpanStatus::Ok, Status::Ok),
        (SpanStatus::Error, Status::error("")),
    ] {
        let (exporter, sink) = recording_sink();

        sink.record(&record(status, Vec::new()));

        assert_eq!(only_span(&exporter).status, expected, "for {status:?}");
    }
}

#[test]
fn an_error_status_carries_no_description_because_the_reason_is_an_allowlisted_code() {
    // A free-text message would be the one field the privacy allowlist never sees.
    let (exporter, sink) = recording_sink();

    sink.record(&record(SpanStatus::Error, Vec::new()));

    match only_span(&exporter).status {
        Status::Error { description } => assert!(description.is_empty(), "got {description:?}"),
        other => panic!("an error record must export as an error status, got {other:?}"),
    }
}

#[test]
fn every_value_shape_the_vocabulary_defines_survives_the_crossing_with_its_type() {
    // The record type is part of the specification, so Go will emit all five shapes. A shape mapped to
    // the wrong OTel type is not a compile error and not a dropped attribute — it is a dashboard that
    // cannot aggregate the field, discovered much later.
    let (exporter, sink) = recording_sink();

    sink.record(&record(
        SpanStatus::Ok,
        vec![
            Attribute::new(
                attr::CONNECTION_ID,
                AttributeValue::Text("host.default.podman.native".to_string()),
            ),
            Attribute::new(attr::EXEC_EXIT_CODE, AttributeValue::Int(-1)),
            Attribute::new(attr::EXEC_DURATION_MS, AttributeValue::Float(12.5)),
            Attribute::new(attr::STARTUP_STATUS, AttributeValue::Bool(true)),
            Attribute::new(
                attr::TRANSPORT,
                AttributeValue::TextList(vec!["ssh".to_string(), "native".to_string()]),
            ),
        ],
    ));

    let span = only_span(&exporter);
    assert_eq!(
        attribute_of(&span, attr::CONNECTION_ID),
        Value::String("host.default.podman.native".into())
    );
    assert_eq!(attribute_of(&span, attr::EXEC_EXIT_CODE), Value::I64(-1));
    assert_eq!(
        attribute_of(&span, attr::EXEC_DURATION_MS),
        Value::F64(12.5)
    );
    assert_eq!(attribute_of(&span, attr::STARTUP_STATUS), Value::Bool(true));
    assert_eq!(
        attribute_of(&span, attr::TRANSPORT).to_string(),
        r#"["ssh","native"]"#
    );
}

#[test]
fn the_allowlist_is_applied_here_and_a_rejected_attribute_never_reaches_the_span() {
    // The claim rests on: this is the last code that runs before an attribute leaves the
    // process, so an argv that was filtered anywhere earlier could still be added by a later caller.
    let (exporter, sink) = recording_sink();

    let dropped = sink.export(&record(
        SpanStatus::Ok,
        vec![
            Attribute::new(
                attr::CONNECTION_ID,
                AttributeValue::Text("host.default.podman.native".to_string()),
            ),
            Attribute::new(
                attr::sensitive::EXEC_ARGV,
                AttributeValue::TextList(vec!["ssh".to_string(), "-oPassword=hunter2".to_string()]),
            ),
        ],
    ));

    assert_eq!(
        dropped,
        vec![(
            attr::sensitive::EXEC_ARGV.to_string(),
            Dropped::NotAllowlisted
        )]
    );
    let span = only_span(&exporter);
    assert_eq!(span.attributes.len(), 1, "{:?}", span.attributes);
    assert_eq!(
        attribute_of(&span, attr::CONNECTION_ID),
        Value::String("host.default.podman.native".into())
    );
}

#[test]
fn recording_through_the_seam_and_exporting_directly_produce_the_same_span() {
    // `TraceSink::record` is what a generic caller holds, and it discards the dropped list. It must not
    // become a second, quieter code path.
    let (through_seam, sink) = recording_sink();
    let span = record(
        SpanStatus::Error,
        vec![Attribute::new(attr::ATTEMPT, AttributeValue::Int(3))],
    );
    TraceSink::record(&sink, &span);

    let (directly, other_sink) = recording_sink();
    let dropped = other_sink.export(&span);

    assert!(dropped.is_empty(), "{dropped:?}");
    let seam = only_span(&through_seam);
    let direct = only_span(&directly);
    assert_eq!(seam.name, direct.name);
    assert_eq!(seam.status, direct.status);
    assert_eq!(seam.start_time, direct.start_time);
    assert_eq!(seam.end_time, direct.end_time);
    assert_eq!(attribute_of(&seam, attr::ATTEMPT), Value::I64(3));
    assert_eq!(attribute_of(&direct, attr::ATTEMPT), Value::I64(3));
}
