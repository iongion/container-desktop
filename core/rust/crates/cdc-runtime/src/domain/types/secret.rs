//! `types/secret.ts` — a secret's metadata. The VALUE never travels; only the engine holds it.

use super::null_default;
use std::collections::BTreeMap;

/// `Secret`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Secret {
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Spec")]
    pub spec: SecretSpec,
    #[serde(rename = "UpdatedAt")]
    pub updated_at: String,
}
/// `SecretSpec`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecretSpec {
    #[serde(rename = "Driver")]
    pub driver: SecretSpecDriver,
    #[serde(rename = "Name")]
    pub name: String,
}
/// `SecretSpecDriver`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SecretSpecDriver {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Options", deserialize_with = "null_default")]
    pub options: BTreeMap<String, String>,
}
