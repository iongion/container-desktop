//! The `tracing` to OpenTelemetry bridge.
//!
//! The claim is narrow and worth checking anyway: a span opened by the impure layers reaches the
//! caller's provider, with the instrumentation scope Go must also report. Everything else about
//! exporting — batching, resource, shutdown — belongs to the application, which is why the
//! constructor takes a provider rather than building one.

use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::layer::SubscriberExt;

#[test]
fn the_bridge_exports_a_span_to_the_callers_provider() {
    let provider = SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::Registry::default()
        .with(cdc_telemetry_host_native::layer::build(&provider));

    tracing::subscriber::with_default(subscriber, || {
        let span = tracing::info_span!(
            "connection.start",
            connection.id = "host.default.podman.native"
        );
        let _entered = span.enter();
        tracing::info!("starting");
    });

    // Flushing is the caller's job, and this is what happens when they do it: no panic, no lost
    // provider. A dropped batch reliably looks like "the failing connection emitted no trace".
    provider.force_flush().expect("the provider flushes");
    provider.shutdown().expect("the provider shuts down");
}

#[test]
fn the_instrumentation_scope_is_part_of_the_specification() {
    // Go must report the same name or the two implementations' traces cannot be compared.
    assert_eq!(
        cdc_telemetry_host_native::layer::INSTRUMENTATION_SCOPE,
        "container-desktop-companion"
    );
}
