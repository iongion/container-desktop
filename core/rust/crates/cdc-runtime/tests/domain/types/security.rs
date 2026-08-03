//! A scanner's report — the one shape here the APP produces, so its status is a closed vocabulary.

use cdc_runtime::domain::types::security::{SecurityReport, SecurityReportStatus};
use serde_json::json;

#[test]
fn a_failed_scan_carries_its_fault_and_no_result() {
    let report: SecurityReport = serde_json::from_value(json!({
        "provider": "trivy",
        "status": "failure",
        "fault": {"details": "no database", "error": "ENOENT"},
        "counts": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    }))
    .expect("a failed report");

    assert_eq!(report.status, SecurityReportStatus::Failure);
    assert!(report.result.is_none());
    assert_eq!(report.fault.expect("a fault").error, "ENOENT");
}

#[test]
fn a_status_outside_the_vocabulary_is_refused() {
    // The app writes this field, so an unknown value is a bug rather than an engine's answer.
    assert!(
        serde_json::from_value::<SecurityReport>(json!({"provider": "trivy", "status": "pending"}))
            .is_err()
    );
}

#[test]
fn a_group_without_vulnerabilities_reads_as_the_empty_list() {
    let report: SecurityReport = serde_json::from_value(json!({
        "provider": "trivy",
        "status": "success",
        "result": {"Results": [{"Class": "os-pkgs", "Target": "alpine", "Vulnerabilities": null}]}
    }))
    .expect("a clean report");

    let groups = report.result.expect("a result").results;
    assert!(groups[0].vulnerabilities.is_empty());
}

#[test]
fn the_security_vocabulary_agrees_with_itself_on_the_wire() {
    super::agrees_on_the_wire(SecurityReportStatus::VOCABULARY);
}
