//! Native trace export: the concrete backend for `cdc-telemetry`, on a machine with a network.
//!
//! `cdc-telemetry` decides what a trace SAYS — the vocabulary, the privacy allowlist, the record. This
//! crate is where that becomes bytes on a wire, and it is the only place in the workspace that knows
//! OpenTelemetry exists. A browser or embedded host is a sibling of this crate, not a change to any
//! crate above it.
//!
//! | This crate | Provides |
//! |---|---|
//! | [`exporter`] | a real OTLP/HTTP exporter and the provider that batches into it |
//! | [`sink`] | `cdc_telemetry::trace::TraceSink`, implemented over that provider |
//! | [`layer`] | the `tracing` bridge, for code that instruments with spans rather than records |
//!
//! **Flushing is not optional.** A batching exporter drops whatever is still queued when the process
//! exits, which reliably looks like "the failing connection emitted no trace" — the one trace anyone
//! wanted. Dropping an [`exporter::Pipeline`] flushes it, and [`exporter::Pipeline::shutdown`] is for
//! the caller that needs to know whether the last batch actually landed — a drop cannot say.

pub mod exporter;
pub mod layer;
pub mod sink;
