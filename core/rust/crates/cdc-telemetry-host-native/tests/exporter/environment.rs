//! Reading the OTLP variables out of the real process environment.
//!
//! **A CHILD is born with them; nothing here sets them.** `std::env::set_var` is `unsafe` in edition
//! 2024 and this workspace forbids `unsafe` — but the rule it enforces was always true: cargo runs
//! these tests concurrently in one binary, and mutating the environment out from under the other
//! threads reading it is undefined behaviour, not merely untidy. A process that starts with the
//! variables already set makes the same claim, and it is how the app is actually configured.
//!
//! `Config::resolve` is where the precedence rule is asserted (`tests/exporter/main.rs`); what is
//! left to prove is only that the wrapper reads the three variables the specification names.

use std::process::Command;

use cdc_telemetry_host_native::exporter::{
    Config, ENDPOINT_VAR, Pipeline, SERVICE_NAME_VAR, TRACES_ENDPOINT_VAR,
};

/// The test's name as the harness registers it — the crate root is not part of it.
const TEST: &str = "environment::the_pipeline_configures_itself_from_the_standard_otlp_variables";

/// Set by the parent, so the child asserts instead of spawning again.
const IN_THE_CHILD: &str = "CDC_OTLP_ENVIRONMENT_CHILD";

/// Printed by the child at the end. **The parent asserts on it**, because `--exact` with a name that
/// matches nothing runs zero tests and still exits 0 — a green parent proving nothing at all.
const REACHED_THE_END: &str = "cdc: the child read the environment";

#[test]
fn the_pipeline_configures_itself_from_the_standard_otlp_variables() {
    if std::env::var(IN_THE_CHILD).is_err() {
        let output = Command::new(std::env::current_exe().expect("this test binary"))
            .args(["--exact", TEST, "--nocapture"])
            .env(IN_THE_CHILD, "1")
            .env(ENDPOINT_VAR, "http://general.invalid:4318")
            .env(TRACES_ENDPOINT_VAR, "http://traces.invalid:4318/")
            .env(SERVICE_NAME_VAR, "cdc-environment-test")
            .output()
            .expect("the child test binary runs");

        let said = String::from_utf8_lossy(&output.stdout);
        assert!(output.status.success(), "the child failed:\n{said}");
        assert!(
            said.contains(REACHED_THE_END),
            "the child ran no test — is {TEST} still its name?\n{said}"
        );
        return;
    }

    let config = Config::from_env();

    // The traces-specific variable wins, and the trailing slash is gone — `//v1/traces` is a 404 that
    // the SDK logs and drops, so a wrong endpoint looks exactly like a working one.
    assert_eq!(config.endpoint, "http://traces.invalid:4318");
    assert_eq!(config.traces_url(), "http://traces.invalid:4318/v1/traces");
    assert_eq!(config.service_name, "cdc-environment-test");

    // The pipeline reads the same variables, and reports what it resolved: a caller that cannot see
    // where its spans are going cannot diagnose a collector it never reached.
    let pipeline = Pipeline::from_env().expect("the pipeline builds from the environment");
    assert_eq!(pipeline.config(), &config);

    println!("{REACHED_THE_END}");
}
