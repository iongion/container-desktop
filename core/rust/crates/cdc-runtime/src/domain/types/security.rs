//! `types/security.ts` — what an image scanner answered.
//!
//! The scanner is an external program (Trivy) and this is its report as the app carries it, not a
//! shape either engine produces.

use super::null_default;
use serde_json::Value;

wire_enum! {
    /// `SecurityReport.status`
    SecurityReportStatus {
        Success = "success",
        Failure = "failure",
    }
}
/// `SecurityReport`. The one shape here the APP produces rather than reads, so its status is the
/// closed vocabulary above and not a string.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct SecurityReport {
    #[serde(default)]
    pub counts: SecurityReportCounts,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fault: Option<SecurityReportFault>,
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<SecurityReportResult>,
    #[serde(default)]
    pub scanner: SecurityScanner,
    pub status: SecurityReportStatus,
}
/// `SecurityReport.counts` — one per severity the app renders.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecurityReportCounts {
    #[serde(rename = "CRITICAL")]
    pub critical: i64,
    #[serde(rename = "HIGH")]
    pub high: i64,
    #[serde(rename = "LOW")]
    pub low: i64,
    #[serde(rename = "MEDIUM")]
    pub medium: i64,
}
/// `SecurityReport.fault` — why the scan produced nothing.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecurityReportFault {
    pub details: String,
    pub error: String,
}
/// `SecurityReportResult`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecurityReportResult {
    #[serde(rename = "Results", deserialize_with = "null_default")]
    pub results: Vec<SecurityReportResultGroup>,
}
/// `SecurityReportResultGroup` — one scanned target.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecurityReportResultGroup {
    #[serde(rename = "Class")]
    pub class: String,
    /// Injected by the app so a row has a stable key; not the scanner's.
    pub guid: String,
    #[serde(rename = "Target")]
    pub target: String,
    #[serde(rename = "Type")]
    pub type_: String,
    #[serde(rename = "Vulnerabilities", deserialize_with = "null_default")]
    pub vulnerabilities: Vec<SecurityVulnerability>,
}
/// `SecurityVulnerability`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecurityVulnerability {
    #[serde(rename = "Description")]
    pub description: String,
    /// Injected by the app, as on the group above.
    pub guid: String,
    #[serde(rename = "InstalledVersion", skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    #[serde(rename = "PkgName", skip_serializing_if = "Option::is_none")]
    pub pkg_name: Option<String>,
    #[serde(rename = "PrimaryURL")]
    pub primary_url: String,
    #[serde(rename = "Published")]
    pub published: String,
    #[serde(rename = "Severity")]
    pub severity: String,
    #[serde(rename = "VulnerabilityID")]
    pub vulnerability_id: String,
}
/// `SecurityReport.scanner` — which tool answered, and how old its database is.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecurityScanner {
    pub database: SecurityScannerDatabase,
    pub name: String,
    pub path: String,
    pub version: String,
}
/// `SecurityReport.scanner.database`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecurityScannerDatabase {
    #[serde(rename = "Version")]
    pub version: String,
    #[serde(rename = "VulnerabilityDB")]
    pub vulnerability_db: SecurityScannerVulnerabilityDb,
}
/// `SecurityReport.scanner.database.VulnerabilityDB`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecurityScannerVulnerabilityDb {
    #[serde(rename = "DownloadedAt")]
    pub downloaded_at: String,
    #[serde(rename = "NextUpdate")]
    pub next_update: String,
    #[serde(rename = "UpdatedAt")]
    pub updated_at: String,
    /// Untyped in the original, and it is a schema number the app never reads.
    #[serde(rename = "Version")]
    pub version: Value,
}
