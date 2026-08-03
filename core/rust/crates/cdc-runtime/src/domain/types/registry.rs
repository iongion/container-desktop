//! `types/registry.ts` — a registry, its trust, its sign-in state, and certificate authorities.

use super::engine::ContainerEngine;

/// One registry the app knows about. `default` entries are the shipped set and `custom` are the
/// user's — the split is [`RegistriesMap`]'s, not a field.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Registry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<RegistryAuthInfo>,
    pub created: String,
    pub enabled: bool,
    /// Which engines offer it. A LIST because a registry is offered per engine, not per connection.
    pub engine: Vec<ContainerEngine>,
    pub id: String,
    #[serde(rename = "isRemovable")]
    pub is_removable: bool,
    #[serde(rename = "isSystem")]
    pub is_system: bool,
    #[serde(rename = "mirrorOf", skip_serializing_if = "Option::is_none")]
    pub mirror_of: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls: Option<RegistryTlsState>,
    pub weight: i64,
}
/// `RegistriesMap`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct RegistriesMap {
    pub custom: Vec<Registry>,
    pub default: Vec<Registry>,
}
/// `RegistrySearchFilters`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct RegistrySearchFilters {
    #[serde(rename = "isAutomated", skip_serializing_if = "Option::is_none")]
    pub is_automated: Option<bool>,
    #[serde(rename = "isOfficial", skip_serializing_if = "Option::is_none")]
    pub is_official: Option<bool>,
}
/// `RegistrySearchOptions`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct RegistrySearchOptions {
    pub filters: RegistrySearchFilters,
    pub registry: Registry,
    pub term: String,
}
/// `RegistryPullOptions`. The original's `onProgress` callback is not a field and does not travel:
/// progress is a STREAM here, which [`Http::stream`](crate::capabilities::http::Http::stream) is.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct RegistryPullOptions {
    pub image: String,
}
/// One row of `/images/search`. PascalCase because that is what the engines answer, and `Official`
/// and `Automated` are STRINGS on the wire rather than booleans.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct RegistrySearchResult {
    #[serde(rename = "Automated")]
    pub automated: String,
    #[serde(rename = "Description")]
    pub description: String,
    /// Which registry answered. Seeded from the searched registry when the engine leaves it empty —
    /// [`normalize_registry_search_result`](crate::domain::normalizers::normalize_registry_search_result).
    #[serde(rename = "Index")]
    pub index: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Official")]
    pub official: String,
    #[serde(rename = "Stars")]
    pub stars: i64,
    #[serde(rename = "Tag")]
    pub tag: String,
}
/// `CertAuthority`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct CertAuthority {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    pub host: String,
    pub id: String,
    /// ISO timestamp.
    #[serde(rename = "installedAt")]
    pub installed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pem: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<CertAuthorityStatus>,
}
wire_enum! {
    /// `CertAuthorityStatus`
    CertAuthorityStatus {
        Trusted = "trusted",
        Expiring = "expiring",
        Expired = "expired",
    }
}
/// Display-only sign-in state. NEVER a secret — the credential lives only in the engine's
/// auth.json, written via `login --password-stdin`; the app keeps nothing.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct RegistryAuthInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    pub kind: RegistryAuthInfoKind,
    #[serde(
        rename = "rateLimited",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub rate_limited: Option<bool>,
}
wire_enum! {
    /// `RegistryAuthInfoKind`
    RegistryAuthInfoKind {
        Anonymous = "anonymous",
        User = "user",
        Pat = "pat",
        Robot = "robot",
    }
}
wire_enum! {
    /// `RegistryTlsState`
    RegistryTlsState {
        Verify = "verify",
        SelfSigned = "self-signed",
        Insecure = "insecure",
    }
}
/// `RegistryTrustEntry`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct RegistryTrustEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<RegistryAuthInfo>,
    pub enabled: bool,
    #[serde(rename = "mirrorOf", default, skip_serializing_if = "Option::is_none")]
    pub mirror_of: Option<String>,
    pub name: String,
    pub order: i64,
    pub tls: RegistryTlsState,
}
