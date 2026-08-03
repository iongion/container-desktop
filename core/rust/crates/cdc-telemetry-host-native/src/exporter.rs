//! The exporter, and the answer to "so where does the telemetry actually go".
//!
//! OTLP over HTTP with protobuf bodies, to `<endpoint>/v1/traces`. That transport rather than gRPC
//! because it is what every collector accepts on port 4318, it needs no gRPC stack, and it is what the
//! rest of this organisation's services already export to.
//!
//! The endpoint comes from the environment, using the names the OpenTelemetry specification defines, so
//! this agrees with every other exporter on the machine instead of inventing a variable of its own.

use std::time::Duration;

use opentelemetry::KeyValue;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{SpanExporter, WithExportConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::trace::{SdkTracer, SdkTracerProvider};

/// `OTEL_EXPORTER_OTLP_ENDPOINT` — the collector's base URL.
pub const ENDPOINT_VAR: &str = "OTEL_EXPORTER_OTLP_ENDPOINT";
/// `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` — the traces-specific override, which wins when both are set.
pub const TRACES_ENDPOINT_VAR: &str = "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT";
/// `OTEL_SERVICE_NAME` — what the backend files these spans under.
pub const SERVICE_NAME_VAR: &str = "OTEL_SERVICE_NAME";

/// Where a collector listens when nothing says otherwise: the OTLP/HTTP default port on this machine.
pub const DEFAULT_ENDPOINT: &str = "http://localhost:4318";
/// The service name to report when the environment does not say. Not "unknown_service", which is what
/// the SDK would default to and what makes a dashboard useless.
pub const DEFAULT_SERVICE_NAME: &str = "container-desktop-connection";

/// How long `shutdown` waits for the last batch. Short: it runs on the way out, and a process that
/// hangs on exit to flush telemetry is worse than a lost span.
pub const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("the OTLP exporter could not be built for {endpoint}: {source}")]
    Build {
        endpoint: String,
        source: opentelemetry_otlp::ExporterBuildError,
    },
    #[error("flushing traces failed: {0}")]
    Flush(String),
}

/// How the exporter is configured. Read from the environment by [`Config::from_env`], or built directly
/// by a caller that has its own settings — an embedder may not have an environment at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// The collector base URL. `/v1/traces` is appended, exactly as the OTLP/HTTP spec requires.
    pub endpoint: String,
    pub service_name: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            endpoint: DEFAULT_ENDPOINT.to_string(),
            service_name: DEFAULT_SERVICE_NAME.to_string(),
        }
    }
}

impl Config {
    /// The standard OTLP variables. Pure in its inputs so the precedence rule is testable without
    /// touching the process environment — `from_env` is the thin wrapper that reads it.
    pub fn resolve(
        traces_endpoint: Option<String>,
        endpoint: Option<String>,
        service_name: Option<String>,
    ) -> Self {
        let endpoint = traces_endpoint
            .or(endpoint)
            .map(|value| value.trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_ENDPOINT.to_string());
        Self {
            endpoint,
            service_name: service_name
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| DEFAULT_SERVICE_NAME.to_string()),
        }
    }

    pub fn from_env() -> Self {
        Self::resolve(
            std::env::var(TRACES_ENDPOINT_VAR).ok(),
            std::env::var(ENDPOINT_VAR).ok(),
            std::env::var(SERVICE_NAME_VAR).ok(),
        )
    }

    /// The URL spans are POSTed to. Spelled out because it is the one thing a misconfiguration gets
    /// wrong silently: a collector answers 404 for the wrong path and the SDK logs it and drops on.
    pub fn traces_url(&self) -> String {
        format!("{}/v1/traces", self.endpoint)
    }
}

/// A live export pipeline: a batching provider over a real OTLP exporter.
///
/// Owning it is what keeps export alive, and dropping it is what stops it — so a caller holds this for
/// as long as it wants traces. **Dropping it is the last-chance flush**, and there is deliberately no
/// `Drop` impl here doing that: `SdkTracerProvider` shuts itself down when dropped unless it already
/// was, and a second `force_flush` one line earlier is a line no test can distinguish. What it cannot
/// do is TELL anyone, which is what [`Pipeline::shutdown`] is for.
pub struct Pipeline {
    provider: SdkTracerProvider,
    config: Config,
}

impl Pipeline {
    /// Build the pipeline. Fails only if the exporter itself cannot be constructed (a malformed
    /// endpoint, say); it does NOT wait for the collector, because a collector that is not up yet must
    /// not stop a connection from being made.
    pub fn build(config: Config) -> Result<Self, ExportError> {
        let exporter = SpanExporter::builder()
            .with_http()
            .with_endpoint(config.traces_url())
            .build()
            .map_err(|source| ExportError::Build {
                endpoint: config.traces_url(),
                source,
            })?;
        let provider = SdkTracerProvider::builder()
            .with_batch_exporter(exporter)
            .with_resource(
                Resource::builder()
                    .with_attributes([KeyValue::new("service.name", config.service_name.clone())])
                    .build(),
            )
            .build();
        Ok(Self { provider, config })
    }

    /// From the standard environment variables.
    pub fn from_env() -> Result<Self, ExportError> {
        Self::build(Config::from_env())
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn provider(&self) -> &SdkTracerProvider {
        &self.provider
    }

    /// The tracer spans are opened on.
    pub fn tracer(&self) -> SdkTracer {
        self.provider.tracer(crate::layer::INSTRUMENTATION_SCOPE)
    }

    /// Push whatever is queued now, and report whether the collector took it.
    pub fn flush(&self) -> Result<(), ExportError> {
        self.provider
            .force_flush()
            .map_err(|error| ExportError::Flush(error.to_string()))
    }

    /// Flush and stop. Worth having beside the implicit drop because a caller on the way out usually
    /// wants to KNOW that the last batch landed, and a drop cannot tell it.
    ///
    /// It flushes FIRST, and that is not redundant: the SDK's own shutdown reports whether the pipeline
    /// stopped, not whether the queue was delivered — it answers `Ok` for a batch that failed to reach
    /// the collector, which is the one thing a caller shutting down wants to hear about.
    ///
    /// **The stop's own result is dropped, and it carries nothing.** The provider refuses only when it
    /// is already stopped, or its processor is busy or gone — and every one of those makes the flush
    /// above refuse first, which was checked by running it. The one failure a caller would want, a
    /// final batch the collector never took, the SDK's batch processor discards before returning
    /// (`opentelemetry_sdk` 0.32.1 `span_processor.rs`, `.map(|_| Ok(()))`). Reported, it would be a
    /// branch no caller can reach and no test can enter. It is still ATTEMPTED on the failing path, so
    /// a process leaving through a dead collector stops on this timeout rather than on `Drop`'s
    /// longer default.
    pub fn shutdown(self) -> Result<(), ExportError> {
        let flushed = self.flush();
        let _ = self.provider.shutdown_with_timeout(SHUTDOWN_TIMEOUT);
        flushed
    }
}
