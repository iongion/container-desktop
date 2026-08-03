//! `userSettings.ts` — the slice of `GlobalUserSettings` the core owns.
//!
//! Not a `types/` module in the original: `UserSettingsView` is the subset of `GlobalUserSettings`
//! this core reads and writes, and `ConnectorPreference` and `ReconnectPolicy` are its inline
//! `connector` and `reconnect` members (`userSettings.ts:49-58`). `LegacyConnection` is the
//! pre-migration shape of an entry in its `connections` array. Everything else
//! in the document is carried through untouched — the core must not delete what it does not model
//!.

use super::connection::Connection;
use super::network::ProxyConfig;

/// `ConnectorPreference`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
pub struct ConnectorPreference {
    /// Connection id of the primary connection. Primary is a CLIENT presentation choice; the core
    /// has no singular current connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}
/// Pre-migration shape: `runtime` held the ENGINE and `engine` held the HOST. Detected by the
/// presence of `runtime` on the first entry, then every entry is shifted (host = engine, engine =
/// runtime, delete runtime) and persisted. See.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct LegacyConnection {
    pub engine: String,
    pub runtime: String,
}
/// Global default; a connection overrides it via settings.api.autoReconnect. Absent normalizes to
/// enabled with a 1s to 30s exponential back-off.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ReconnectPolicy {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub factor: Option<f64>,
    #[serde(rename = "initialMs", default, skip_serializing_if = "Option::is_none")]
    pub initial_ms: Option<i64>,
    #[serde(rename = "maxMs", default, skip_serializing_if = "Option::is_none")]
    pub max_ms: Option<i64>,
    #[serde(
        rename = "maxRetries",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub max_retries: Option<i64>,
}
/// Only these paths are owned by the core. Everything else in the document is carried through
/// untouched.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
pub struct UserSettingsView {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connections: Vec<Connection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector: Option<ConnectorPreference>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<ProxyConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reconnect: Option<ReconnectPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}
