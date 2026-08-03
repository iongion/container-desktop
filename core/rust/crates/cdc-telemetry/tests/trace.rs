//! The record a host exports, and the one calculation it carries.
//!
//! `duration_ms` is the number an operator actually reads — "why did this connection take forty
//! seconds" is the question the whole subsystem exists to answer — and it is derived from two readings
//! of a clock this crate does not own.

use cdc_telemetry::trace::{Attribute, AttributeValue, SpanRecord, SpanStatus};

fn span(started_ms: u64, ended_ms: u64) -> SpanRecord {
    SpanRecord {
        name: "cdc.connection.connect".to_string(),
        status: SpanStatus::Ok,
        started_ms,
        ended_ms,
        attributes: Vec::new(),
    }
}

#[test]
fn a_span_reports_the_elapsed_milliseconds_between_its_two_readings() {
    assert_eq!(
        span(1_700_000_000_000, 1_700_000_042_500).duration_ms(),
        42_500
    );
}

#[test]
fn a_clock_that_went_backwards_reports_zero_rather_than_half_the_universe() {
    // Unsigned subtraction, so the wrong arithmetic here does not report a small negative duration —
    // it reports 18 quintillion milliseconds, and a dashboard axis nobody can read again.
    assert_eq!(span(1_700_000_005_000, 1_700_000_000_000).duration_ms(), 0);
    assert_eq!(span(1, 0).duration_ms(), 0);
}

#[test]
fn a_span_that_started_and_ended_on_the_same_millisecond_is_zero_not_one() {
    assert_eq!(span(1_700_000_000_000, 1_700_000_000_000).duration_ms(), 0);
}

#[test]
fn an_attribute_keeps_the_key_it_was_built_with() {
    // `Attribute::new` takes `impl Into<String>` so a caller can pass one of the `attr` constants; a
    // key that arrived transformed would silently fall off the allowlist.
    let attribute = Attribute::new(
        cdc_telemetry::attributes::attr::CONNECTION_ID,
        AttributeValue::Text("host.default.podman.native".to_string()),
    );

    assert_eq!(attribute.key, "cdc.connection.id");
    assert_eq!(
        attribute.value,
        AttributeValue::Text("host.default.podman.native".to_string())
    );
}
