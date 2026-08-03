//! What a trace IS here, in types this crate owns.
//!
//! Deliberately not OpenTelemetry's types. This crate is the generic half of the subsystem: it decides
//! the vocabulary, what may leave the process, and the shape of a record — and a host decides what to
//! DO with one. Depending on the OTel SDK here would make OTel the only possible backend and this crate
//! unusable from a wasm embedding, a test double, a file sink or a Go caller, which is exactly the
//! coupling `cdc-telemetry-host-native` exists to hold.

/// An attribute value. The five shapes the connection vocabulary actually uses — closed-vocabulary
/// strings, opaque ids, counts, durations and flags — and no more, because every additional shape is
/// another thing the privacy bound has to reason about.
#[derive(Debug, Clone, PartialEq)]
pub enum AttributeValue {
    Text(String),
    Int(i64),
    Float(f64),
    Bool(bool),
    TextList(Vec<String>),
}

impl AttributeValue {
    /// The characters this value would occupy once exported. What the privacy bound is expressed in:
    /// only text can be unbounded, so numbers and flags answer 0 rather than a length nobody checks.
    pub fn exported_chars(&self) -> usize {
        match self {
            AttributeValue::Text(text) => text.chars().count(),
            // Joined, because a list of a thousand short strings is as much of an exfiltration channel
            // as one long string — the separator is what a naive per-item check would miss.
            AttributeValue::TextList(items) => {
                items.iter().map(|item| item.chars().count()).sum::<usize>() + items.len()
            }
            _ => 0,
        }
    }
}

/// One key/value pair, after filtering.
#[derive(Debug, Clone, PartialEq)]
pub struct Attribute {
    pub key: String,
    pub value: AttributeValue,
}

impl Attribute {
    pub fn new(key: impl Into<String>, value: AttributeValue) -> Self {
        Self {
            key: key.into(),
            value,
        }
    }
}

/// Whether the operation a span covers succeeded. Three states, not two: an unset status is what an
/// in-flight span has, and reporting it as success is how a crashed connection looks healthy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpanStatus {
    Unset,
    Ok,
    Error,
}

/// One finished span, ready for a host to export.
///
/// Times are milliseconds on the clock the caller was handed — the same monotonic-and-origin-arbitrary
/// convention `ConnectionRuntimeInfo.next_retry_at` uses, and for the same reason: a runtime that read
/// the wall clock itself would need a clock, which is a facility it may not have.
#[derive(Debug, Clone, PartialEq)]
pub struct SpanRecord {
    pub name: String,
    pub status: SpanStatus,
    pub started_ms: u64,
    pub ended_ms: u64,
    pub attributes: Vec<Attribute>,
}

impl SpanRecord {
    /// How long the operation took. Saturating, because a clock that went backwards between two
    /// readings must not produce a duration that wraps to half the universe.
    pub fn duration_ms(&self) -> u64 {
        self.ended_ms.saturating_sub(self.started_ms)
    }
}

/// Where finished spans go. The seam between this crate and a host.
///
/// One method, taking one finished span: batching, retries, protocol and shutdown are entirely the
/// host's business, because they are entirely about the platform it is on.
pub trait TraceSink: Send + Sync {
    fn record(&self, span: &SpanRecord);
}
