//! The vocabulary is part of the specification (Go must match it), so its internal consistency is
//! worth asserting rather than eyeballing.

use cdc_telemetry::attributes::{attr, program_basename, span};
use std::collections::HashSet;

#[test]
fn span_names_are_unique_and_prefixed() {
    let unique: HashSet<_> = span::ALL.iter().collect();
    assert_eq!(
        unique.len(),
        span::ALL.len(),
        "duplicate span name in span::ALL"
    );
    for name in span::ALL {
        assert!(
            name.starts_with("cdc."),
            "{name} must be namespaced under cdc."
        );
    }
}

#[test]
fn exportable_and_sensitive_sets_are_disjoint() {
    // A key in both lists would mean the allowlist and the "never export this" list disagree —
    // and the allowlist would win, silently.
    let exportable: HashSet<_> = attr::EXPORTABLE.iter().collect();
    for key in attr::sensitive::ALL {
        assert!(
            !exportable.contains(key),
            "{key} is in BOTH the exportable and sensitive lists"
        );
    }
}

#[test]
fn attribute_keys_are_unique_and_prefixed() {
    for list in [attr::EXPORTABLE, attr::sensitive::ALL] {
        let unique: HashSet<_> = list.iter().collect();
        assert_eq!(unique.len(), list.len(), "duplicate attribute key");
        for key in list {
            assert!(
                key.starts_with("cdc."),
                "{key} must be namespaced under cdc."
            );
        }
    }
}

#[test]
fn program_basename_strips_the_home_directory() {
    // The most common accidental username leak in this subsystem: every detected engine path on
    // Linux and macOS runs through a home directory.
    assert_eq!(program_basename("/home/istoica/bin/podman"), "podman");
    assert_eq!(program_basename("/usr/bin/docker"), "docker");
    assert_eq!(
        program_basename("C:\\Users\\ionut\\podman.exe"),
        "podman.exe"
    );
    assert_eq!(program_basename("podman"), "podman");
}

#[test]
fn program_basename_handles_degenerate_paths() {
    assert_eq!(program_basename("/usr/bin/"), "bin");
    assert_eq!(program_basename("/"), "/");
    assert_eq!(program_basename(""), "");
}
