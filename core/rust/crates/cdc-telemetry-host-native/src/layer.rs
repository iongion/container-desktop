//! Bridging `tracing` spans to OpenTelemetry.
//!
//! For code that instruments with `tracing` spans rather than handing [`crate::sink`] a record. The
//! bridge takes a caller-built `TracerProvider` rather than reading the environment and deciding for
//! you — the same injection discipline the capabilities use.
//!
//! [`crate::exporter::Pipeline`] is the provider this crate ships, and `pipeline.provider()` is what
//! goes in here. A caller with its own provider is equally welcome; that is the point of the seam.

use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_opentelemetry::OpenTelemetryLayer;

/// Instrumentation scope name reported to the backend.
pub const INSTRUMENTATION_SCOPE: &str = "container-desktop-companion";

/// Build a `tracing` layer that exports to the caller's provider.
///
/// Compose it into a subscriber:
///
/// ```rust,ignore
/// use tracing_subscriber::layer::SubscriberExt;
///
/// let provider = /* application-owned SdkTracerProvider */;
/// let subscriber = tracing_subscriber::Registry::default().with(crate::layer::build(&provider));
/// tracing::subscriber::set_global_default(subscriber)?;
/// ```
///
/// Flushing and shutdown stay with the caller, who owns the provider: call `force_flush` before
/// process exit or the last batch is lost, which reliably looks like "the failing connection emitted
/// no trace" — the one trace anyone wanted.
pub fn build<S>(
    provider: &SdkTracerProvider,
) -> OpenTelemetryLayer<S, opentelemetry_sdk::trace::SdkTracer>
where
    S: tracing::Subscriber + for<'span> tracing_subscriber::registry::LookupSpan<'span>,
{
    use opentelemetry::trace::TracerProvider as _;
    tracing_opentelemetry::layer().with_tracer(provider.tracer(INSTRUMENTATION_SCOPE))
}
