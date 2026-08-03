//! `cdc_telemetry::trace::TraceSink`, implemented over OpenTelemetry.
//!
//! The mapping is the whole crate's reason to exist: the runtime's subsystem speaks in its own record
//! type, and this turns one into an OTel span on a real provider. Two things happen here that cannot
//! happen anywhere else:
//!
//! - **The privacy allowlist is applied at the export point.** Not by the caller, and not hopefully:
//!   this is the last code that runs before an attribute leaves the process, so it is the only place
//!   the rule cannot be forgotten.
//! - **The record's own timestamps are honoured.** A connection span covers seconds of process
//!   execution and is recorded after the fact, so a span stamped "now" on both ends would report every
//!   bring-up as instantaneous.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use cdc_telemetry::privacy::{self, Dropped};
use cdc_telemetry::trace::{Attribute, AttributeValue, SpanRecord, SpanStatus, TraceSink};
use opentelemetry::trace::{Span, SpanBuilder, Status, Tracer};
use opentelemetry::{Array, Key, KeyValue, StringValue, Value};
use opentelemetry_sdk::trace::SdkTracer;

/// Export spans to an OpenTelemetry tracer.
pub struct OtelSink {
    tracer: SdkTracer,
}

impl OtelSink {
    pub fn new(tracer: SdkTracer) -> Self {
        Self { tracer }
    }

    /// What the allowlist rejected on the way out, for the caller that wants to know. Returned rather
    /// than logged, so a test can assert the filter ran and a diagnostic can say what was withheld.
    pub fn export(&self, span: &SpanRecord) -> Vec<(String, Dropped)> {
        let candidates = span
            .attributes
            .iter()
            .map(|attribute| (attribute.key.clone(), attribute.value.clone()));
        let (kept, dropped) = privacy::filter(candidates);

        let mut builder =
            SpanBuilder::from_name(span.name.clone()).with_start_time(unix_millis(span.started_ms));
        builder.attributes = Some(kept.iter().map(key_value).collect());
        let mut opened = self.tracer.build(builder);
        opened.set_status(status_of(span.status));
        // Ended with the RECORD's timestamp, not with "now". A connection span covers seconds of
        // process execution and is exported after the fact, so ending it here would report every
        // bring-up as instantaneous — and `SpanBuilder` has no end time to set, only a start.
        opened.end_with_timestamp(unix_millis(span.ended_ms));
        dropped
    }
}

impl TraceSink for OtelSink {
    fn record(&self, span: &SpanRecord) {
        let _ = self.export(span);
    }
}

/// A millisecond stamp as a `SystemTime`.
///
/// The record's clock is monotonic and origin-arbitrary by design (a runtime with no clock capability
/// cannot read the wall clock), while OTLP wants wall-clock nanoseconds — so a host is exactly where
/// the two meet, and it does so by treating the stamp as unix millis, which is what every clock this
/// project ships actually supplies.
fn unix_millis(millis: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(millis)
}

fn status_of(status: SpanStatus) -> Status {
    match status {
        SpanStatus::Unset => Status::Unset,
        SpanStatus::Ok => Status::Ok,
        // No description: the reason a connection failed is a `DiagnosticCode` attribute, which is in
        // the allowlist. A free-text message here would be the one field nobody filtered.
        SpanStatus::Error => Status::error(""),
    }
}

fn key_value(attribute: &Attribute) -> KeyValue {
    KeyValue::new(Key::new(attribute.key.clone()), value_of(&attribute.value))
}

fn value_of(value: &AttributeValue) -> Value {
    match value {
        AttributeValue::Text(text) => Value::String(text.clone().into()),
        AttributeValue::Int(number) => Value::I64(*number),
        AttributeValue::Float(number) => Value::F64(*number),
        AttributeValue::Bool(flag) => Value::Bool(*flag),
        AttributeValue::TextList(items) => Value::Array(Array::String(
            items
                .iter()
                .map(|item| StringValue::from(item.clone()))
                .collect(),
        )),
    }
}
