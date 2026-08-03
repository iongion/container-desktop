//! A pod — libpod's alone, and the one resource whose member list arrives `null` on failure.

use cdc_runtime::domain::types::pod::{Pod, PodProcessReport, PodStatusList};
use serde_json::json;

#[test]
fn a_pod_whose_containers_failed_to_list_reads_as_none_rather_than_refusing() {
    // The original's own comment: "Containers is null on failure — coerce to an array".
    let pod: Pod = serde_json::from_value(json!({
        "Id": "p1", "Name": "web", "Status": "Running", "Containers": null, "Labels": null
    }))
    .expect("a pod whose member list failed");

    assert!(pod.containers.is_empty());
    assert!(pod.labels.is_empty());
    assert!(pod.is_running());
}

#[test]
fn a_pod_status_outside_the_vocabulary_still_reads() {
    let pod: Pod = serde_json::from_value(json!({"Id": "p1", "Status": "Initialized"}))
        .expect("libpod answers states the original's enum does not list");

    assert_eq!(pod.status, "Initialized");
    assert!(!pod.is_running());
}

#[test]
fn a_process_report_is_a_row_per_process() {
    let report: PodProcessReport = serde_json::from_value(json!({
        "Titles": ["USER", "PID", "COMMAND"],
        "Processes": [["root", "1", "httpd -D FOREGROUND"]]
    }))
    .expect("libpod answers [][]string");

    assert_eq!(
        report.processes,
        vec![vec!["root", "1", "httpd -D FOREGROUND"]]
    );
}

#[test]
fn the_pod_vocabulary_agrees_with_itself_on_the_wire() {
    super::agrees_on_the_wire(PodStatusList::VOCABULARY);
}
