//! `types/volume.ts` — a volume, whose shape is the same on both surfaces.

use super::null_default;
use std::collections::BTreeMap;

/// `Volume`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Volume {
    #[serde(rename = "Anonymous")]
    pub anonymous: bool,
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "Driver")]
    pub driver: String,
    #[serde(rename = "GID")]
    pub gid: i64,
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    #[serde(rename = "Mountpoint")]
    pub mountpoint: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Options", deserialize_with = "null_default")]
    pub options: BTreeMap<String, String>,
    #[serde(rename = "Scope")]
    pub scope: String,
    #[serde(rename = "Status", deserialize_with = "null_default")]
    pub status: BTreeMap<String, String>,
    #[serde(rename = "UID")]
    pub uid: i64,
    /// Present only when the list was asked for sizes — Docker's `?size=true`. libpod's list omits
    /// it, which is why it is optional rather than defaulted to zeroes that would read as measured.
    #[serde(rename = "UsageData", skip_serializing_if = "Option::is_none")]
    pub usage_data: Option<VolumeUsageData>,
}
/// `Volume.UsageData`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct VolumeUsageData {
    #[serde(rename = "RefCount")]
    pub ref_count: i64,
    #[serde(rename = "Size")]
    pub size: i64,
}
