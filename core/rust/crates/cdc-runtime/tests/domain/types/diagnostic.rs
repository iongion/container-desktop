//! the design's vocabulary on the wire, answering to `src/domain/types/diagnostic.rs`.
//!
//! **The only module of the model the GATES measure**, because it is the only one with a RULE. The
//! other ten are shapes and derives and are excluded from both gates by name; this one decides what
//! happens to a code it does not recognise, and that decision is the whole of the promise
//! makes to a client. Its neighbours have test files too, but what those assert is
//! [`super::agrees_on_the_wire`] — a property of the `wire_enum!` macro, held for every module at
//! once.

use std::collections::BTreeSet;

use cdc_runtime::domain::types::diagnostic::{
    DiagnosticCode, DiagnosticSeverity, ReportedDiagnostic,
};

fn encoded(code: &DiagnosticCode) -> String {
    serde_json::to_string(code).expect("a code serializes")
}

fn decoded(json: &str) -> DiagnosticCode {
    serde_json::from_str(json).expect("a code deserializes")
}

#[test]
fn every_code_travels_as_its_own_name_and_comes_back_as_itself() {
    for code in DiagnosticCode::VOCABULARY {
        let json = encoded(&code);

        assert_eq!(
            json,
            format!("\"{}\"", code.as_str()),
            "a code is a STRING on the wire, and the string is its name"
        );
        assert_eq!(decoded(&json), code, "and it survives the round trip");
    }
}

#[test]
fn the_vocabulary_is_a_set_and_holds_no_unknown() {
    let names: BTreeSet<&str> = DiagnosticCode::VOCABULARY
        .iter()
        .map(DiagnosticCode::as_str)
        .collect();

    assert_eq!(
        names.len(),
        DiagnosticCode::VOCABULARY.len(),
        "two codes sharing a name are one code with two spellings"
    );
    assert!(
        DiagnosticCode::VOCABULARY
            .iter()
            .all(DiagnosticCode::is_known),
        "Unknown is the ABSENCE of a code, so it is not one of them"
    );
}

#[test]
fn a_code_from_a_newer_server_is_kept_rather_than_refused() {
    let code = decoded("\"PROBE_TIMED_OUT\"");

    assert_eq!(
        code,
        DiagnosticCode::Unknown("PROBE_TIMED_OUT".to_string()),
        "the frame is well formed and one field newer than this build; refusing it loses the whole \
         frame to save nothing"
    );
    assert_eq!(
        code.as_str(),
        "PROBE_TIMED_OUT",
        "and the raw code is what a client has to be able to show"
    );
    assert!(!code.is_known());
}

#[test]
fn an_unknown_code_goes_back_onto_the_wire_as_it_arrived() {
    let json = encoded(&decoded("\"PROBE_TIMED_OUT\""));

    assert_eq!(
        json, "\"PROBE_TIMED_OUT\"",
        "a derive would spell it {{\"Unknown\": …}}, and then what the next hop reads would depend \
         on which build forwarded it"
    );
}

#[test]
fn a_whole_refusal_carrying_an_unknown_code_is_still_readable() {
    // The finding this variant exists for: the code is ONE field of a frame, and a closed enum made
    // the whole frame undecodable — so what reached the person was "this could not be read" rather
    // than a diagnostic with a code and its parameters.
    let frame = r#"{"code":"PROBE_TIMED_OUT","params":{"program":"podman"},"severity":"err"}"#;

    let diagnostic: ReportedDiagnostic = serde_json::from_str(frame).expect("a readable frame");

    assert_eq!(
        diagnostic.code,
        DiagnosticCode::Unknown("PROBE_TIMED_OUT".to_string())
    );
    assert_eq!(
        diagnostic.params.get("program").and_then(|it| it.as_str()),
        Some("podman"),
        "and the parameters arrive with it, which is the half worth reading"
    );
    assert_eq!(diagnostic.severity, DiagnosticSeverity::Err);
}

#[test]
fn a_withdrawn_code_is_no_longer_one_of_this_core_s_own() {
    // Declared and never raised, so they were taken out while the only clients were in this tree.
    // They decode as unknown rather than as nothing, which is what makes re-adding them WITH a
    // producer a safe, additive change rather than a second breaking one.
    for withdrawn in [
        "PROGRAM_VERSION_UNREADABLE",
        "CONTROLLER_NOT_FOUND",
        "PORT_NOT_PUBLISHED",
    ] {
        let code = decoded(&format!("\"{withdrawn}\""));

        assert!(
            !code.is_known(),
            "{withdrawn} is withdrawn, so nothing here may claim to raise it"
        );
        assert_eq!(code.as_str(), withdrawn, "and it is still readable");
    }
}

#[test]
fn a_recognised_code_is_the_variant_rather_than_its_text() {
    // Both directions of the same rule, because a `from` that answered `Unknown` for everything
    // would pass every assertion about unknown codes above.
    assert_eq!(
        DiagnosticCode::from("API_UNREACHABLE"),
        DiagnosticCode::ApiUnreachable
    );
    assert_eq!(
        DiagnosticCode::from("API_UNREACHABLE".to_string()),
        DiagnosticCode::ApiUnreachable,
        "an owned string is the same question as a borrowed one"
    );
    assert_eq!(
        DiagnosticCode::from("api_unreachable"),
        DiagnosticCode::Unknown("api_unreachable".to_string()),
        "and the match is exact — a code is an identifier, not a word"
    );
    assert!(DiagnosticCode::ApiUnreachable.is_known());
}

#[test]
fn a_code_reads_as_its_name_when_it_is_printed() {
    assert_eq!(
        DiagnosticCode::SshHostKeyChanged.to_string(),
        "SSH_HOST_KEY_CHANGED"
    );
    assert_eq!(
        DiagnosticCode::Unknown("PROBE_TIMED_OUT".to_string()).to_string(),
        "PROBE_TIMED_OUT",
        "an unknown code prints as what arrived, which is all there is of it"
    );
}

#[test]
fn a_severity_agrees_with_itself_on_the_wire() {
    super::agrees_on_the_wire(DiagnosticSeverity::VOCABULARY);
    assert_eq!(
        DiagnosticSeverity::VOCABULARY,
        [
            DiagnosticSeverity::Ok,
            DiagnosticSeverity::Warn,
            DiagnosticSeverity::Err
        ],
        "the severities are the three every client branches on"
    );
}

#[test]
fn a_severity_this_core_does_not_have_is_refused() {
    // The opposite rule to a code's, and deliberately: a severity is a CLOSED set of three because
    // every client branches on it, where a code is only ever rendered. A fourth severity is a
    // protocol change, not a new entry in a list.
    assert!("fatal".parse::<DiagnosticSeverity>().is_err());
    assert!(serde_json::from_str::<DiagnosticSeverity>("\"fatal\"").is_err());
}

#[test]
fn an_empty_parameter_map_is_absent_rather_than_empty() {
    let json = serde_json::to_string(&ReportedDiagnostic {
        code: DiagnosticCode::NotChecked,
        params: serde_json::Map::new(),
        severity: DiagnosticSeverity::Ok,
    })
    .expect("a report entry serializes");

    assert_eq!(json, r#"{"code":"NOT_CHECKED","severity":"ok"}"#);
}
