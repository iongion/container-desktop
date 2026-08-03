//! Tracing a connection: the vocabulary, what may leave the process, and the shape of a record.
//!
//! A connection bring-up is a multi-step, multi-second, frequently-failing flow across process
//! execution, SSH and HTTP. "Why did this take forty seconds, and where did it fail?" is what a
//! headless server exists to answer, and log lines cannot answer it.
//!
//! Three pieces, deliberately small:
//!
//! - [`attributes`] — the span and attribute vocabulary, as constants. Part of the specification:
//!   Go must emit the same names or the two implementations' traces are not comparable.
//! - [`privacy`] — deny-by-default filtering. Connection data carries usernames (in paths),
//!   hostnames (in scopes and URIs) and credentials (in argv and proxy URLs), so only an explicit
//!   allowlist of closed vocabularies, opaque ids and numbers is exported.
//! - [`trace`] — the record and the [`trace::TraceSink`] seam a host implements. Types this crate owns,
//!   never OpenTelemetry's: a backend is a host's choice, and hard-coding one here would make this
//!   crate unusable from a wasm embedding, a Go caller, a file sink or a test double.
//!
//! No exporter, and no OpenTelemetry dependency at all — both live in `cdc-telemetry-host-native`, the
//! only place that knows a network exists. The runtime's kernel is kept pure by not being instrumented — it emits structured diagnostics, which the golden
//! corpus can assert, where spans cannot. Only the impure layers open spans.
//!
//! No re-exports: `pub mod` and nothing more, per this repo's convention.

pub mod attributes;
pub mod privacy;
pub mod trace;
