//! The allowlist is the security boundary of this crate, so it is tested by trying to get things
//! through it, not by confirming the happy path.

use cdc_telemetry::attributes::attr;
use cdc_telemetry::privacy::{self, Dropped};
use cdc_telemetry::trace::AttributeValue;

fn candidate(key: &str, value: &str) -> (String, AttributeValue) {
    (key.to_string(), AttributeValue::Text(value.to_string()))
}

#[test]
fn every_sensitive_key_is_rejected() {
    // The point of naming sensitive keys in `attributes` is that this test can enumerate them.
    // Each one leaks a username, a hostname or a credential.
    for key in attr::sensitive::ALL {
        assert!(
            !privacy::is_exportable(key),
            "{key} must never be exportable — it leaks user, host or credential data"
        );
    }
}

#[test]
fn every_exportable_key_passes() {
    for key in attr::EXPORTABLE {
        assert!(
            privacy::is_exportable(key),
            "{key} is declared exportable but the allowlist rejects it"
        );
    }
}

#[test]
fn allowlist_matches_exactly_and_not_by_prefix() {
    // Prefix matching would admit cdc.exec.stdin under a `cdc.exec.*` rule. This is the precise
    // mistake the module exists to prevent, so it gets its own test.
    assert!(privacy::is_exportable(attr::EXEC_PROGRAM));
    assert!(!privacy::is_exportable(attr::sensitive::EXEC_STDIN));
    assert!(!privacy::is_exportable("cdc.exec"));
    assert!(!privacy::is_exportable("cdc.exec.program.extra"));
    assert!(!privacy::is_exportable("cdc."));
    assert!(!privacy::is_exportable(""));
}

#[test]
fn unknown_keys_are_dropped_rather_than_passed_through() {
    // Deny-by-default: a key nobody has considered must not be exported just because it looks new.
    let (kept, dropped) = privacy::filter(vec![candidate("cdc.something.invented", "value")]);
    assert!(kept.is_empty());
    assert_eq!(
        dropped,
        vec![(
            "cdc.something.invented".to_string(),
            Dropped::NotAllowlisted
        )]
    );
}

#[test]
fn oversized_values_are_dropped_not_truncated() {
    // A truncated secret is still a secret, and a truncated identifier is misleading.
    let huge = "x".repeat(privacy::MAX_VALUE_CHARS + 1);
    let (kept, dropped) = privacy::filter(vec![candidate(attr::CONNECTION_ID, &huge)]);
    assert!(kept.is_empty());
    assert_eq!(dropped[0].1, Dropped::ValueTooLong);
}

#[test]
fn an_oversized_string_array_is_dropped_like_an_oversized_string() {
    // A list is the same unbounded channel as a string, and an allowlisted key holding one would
    // otherwise leave by the back door.
    let huge = AttributeValue::TextList(vec!["x".repeat(privacy::MAX_VALUE_CHARS)]);

    let (kept, dropped) = privacy::filter(vec![(attr::CONNECTION_ID.to_string(), huge)]);

    assert!(kept.is_empty());
    assert_eq!(dropped[0].1, Dropped::ValueTooLong);
}

#[test]
fn a_short_array_is_within_bounds_and_is_kept() {
    let list = AttributeValue::TextList(vec!["podman".to_string()]);

    let (kept, dropped) = privacy::filter(vec![(attr::CONNECTION_ID.to_string(), list)]);

    assert_eq!(kept.len(), 1);
    assert!(dropped.is_empty());
}

#[test]
fn value_exactly_at_the_bound_is_kept() {
    let exact = "x".repeat(privacy::MAX_VALUE_CHARS);
    let (kept, dropped) = privacy::filter(vec![candidate(attr::CONNECTION_ID, &exact)]);
    assert_eq!(kept.len(), 1);
    assert!(dropped.is_empty());
}

#[test]
fn attribute_count_is_bounded_deterministically() {
    let candidates: Vec<(String, AttributeValue)> = (0..privacy::MAX_ATTRIBUTES + 5)
        .map(|index| (attr::ATTEMPT.to_string(), AttributeValue::Int(index as i64)))
        .collect();
    let (kept, dropped) = privacy::filter(candidates);
    assert_eq!(kept.len(), privacy::MAX_ATTRIBUTES);
    assert_eq!(dropped.len(), 5);
    assert!(
        dropped
            .iter()
            .all(|(_, why)| *why == Dropped::TooManyAttributes)
    );
    // Input order preserved, so the cut is where a reader would predict it.
    assert_eq!(kept[0].value, AttributeValue::Int(0));
}

#[test]
fn numeric_values_are_never_size_dropped() {
    let (kept, dropped) = privacy::filter(vec![(
        attr::EXEC_EXIT_CODE.to_string(),
        AttributeValue::Int(i64::MIN),
    )]);
    assert_eq!(kept.len(), 1);
    assert!(dropped.is_empty());
}
