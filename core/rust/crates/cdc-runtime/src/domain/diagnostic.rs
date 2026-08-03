//! What a unit REFUSES with.
//!
//! The original throws an `Error` carrying an English sentence. A core whose clients render their own
//! prose cannot do that, so every refusal is a code plus its parameters — the one sanctioned
//! divergence from the original, recorded rather than assumed.
//!
//! **This is not [`ReportedDiagnostic`](crate::domain::types::diagnostic::ReportedDiagnostic), and
//! the two must not be merged.** A refusal is ALWAYS a failure and carries no severity; a report
//! entry also has to
//! express `ok` and `not checked`, which is a verdict about a check rather than a failure of one.
//! Giving a refusal a severity field would mean every construction site choosing one, and `Ok`
//! would become constructible where it makes no sense.
//!
//! It lives in its own leaf because every unit produces one, and the module it used to share
//! (`domain::plan`) is gone — a type with real counterparts must not die alongside the invention it
//! was parked next to.

use serde::{Deserialize, Serialize};

use crate::domain::types::diagnostic::DiagnosticCode;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub code: DiagnosticCode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

impl Diagnostic {
    pub fn new(code: DiagnosticCode) -> Self {
        Self { code, params: None }
    }

    pub fn with_params(code: DiagnosticCode, params: serde_json::Value) -> Self {
        Self {
            code,
            params: Some(params),
        }
    }
}
