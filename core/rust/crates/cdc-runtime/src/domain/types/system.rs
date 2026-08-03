//! `types/system.ts` — what an engine says about itself, and what it says it is storing.

use std::collections::BTreeMap;

use serde_json::Value;

use super::engine::Distribution;
use super::null_default;

/// `SystemVersion` — `GET /version`.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SystemVersion {
    #[serde(rename = "APIVersion")]
    pub api_version: String,
    #[serde(rename = "Built")]
    pub built: i64,
    #[serde(rename = "BuiltTime")]
    pub built_time: String,
    #[serde(rename = "GitCommit")]
    pub git_commit: String,
    #[serde(rename = "GoVersion")]
    pub go_version: String,
    #[serde(rename = "OsArch")]
    pub os_arch: String,
    #[serde(rename = "Version")]
    pub version: String,
}
/// `SystemInfo` — `GET /info`.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SystemInfo {
    pub host: SystemInfoHost,
    /// `SystemPlugin` is `any`: the two engines report entirely different plugin trees.
    #[serde(deserialize_with = "null_default")]
    pub plugins: serde_json::Map<String, Value>,
    /// Search order per registry name.
    #[serde(deserialize_with = "null_default")]
    pub registries: BTreeMap<String, Vec<String>>,
    pub store: Value,
    pub version: SystemVersion,
}
/// `SystemInfoHost`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SystemInfoHost {
    pub distribution: Distribution,
    pub hostname: String,
    pub kernel: String,
    pub os: String,
    #[serde(rename = "remoteSocket")]
    pub remote_socket: SystemInfoHostRemoteSocket,
}
/// `SystemInfoHostRemoteSocket` — where the engine says it is listening.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SystemInfoHostRemoteSocket {
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
/// `SystemStore` — the typed half of `SystemInfo.store` the app reads.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SystemStore {
    #[serde(rename = "configFile")]
    pub config_file: String,
    #[serde(rename = "containerStore")]
    pub container_store: SystemContainerStore,
}
/// `SystemStore.containerStore`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SystemContainerStore {
    pub number: i64,
    pub paused: i64,
    pub running: i64,
    pub stopped: i64,
}
/// Image disk usage, summarised from `GET /system/df`. Docker answers `LayersSize` and
/// `Images[].Size/SharedSize`, libpod answers `ImagesSize` and `Images[].UniqueSize`; both reduce to
/// this. "Reclaimable" is the unique bytes of images no container references.
#[derive(serde::Deserialize, serde::Serialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SystemDf {
    #[serde(rename = "imagesCount")]
    pub images_count: i64,
    #[serde(rename = "imagesReclaimable")]
    pub images_reclaimable: i64,
    #[serde(rename = "imagesSize")]
    pub images_size: i64,
    #[serde(rename = "reclaimableCount")]
    pub reclaimable_count: i64,
}
/// `ContextInspect` — `docker context inspect`. A CONTEXT, not a scope; see
/// [`EngineContext`](super::engine::EngineContext), which is what the dialect lists.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContextInspect {
    #[serde(rename = "Endpoints")]
    pub endpoints: ContextInspectEndpoints,
    #[serde(rename = "Metadata")]
    pub metadata: Value,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Storage")]
    pub storage: ContextInspectStorage,
    #[serde(rename = "TLSMaterial")]
    pub tls_material: Value,
}
/// `ContextInspect.Endpoints`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContextInspectEndpoints {
    pub docker: ContextInspectDockerEndpoint,
}
/// `ContextInspect.Endpoints.docker`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContextInspectDockerEndpoint {
    #[serde(rename = "Host")]
    pub host: String,
    #[serde(rename = "SkipTLSVerify")]
    pub skip_tls_verify: bool,
}
/// `ContextInspect.Storage`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContextInspectStorage {
    #[serde(rename = "MetadataPath")]
    pub metadata_path: String,
    #[serde(rename = "TLSPath")]
    pub tls_path: String,
}
/// `SystemPruneReport`. Each per-resource report is untyped for the reason the original leaves them
/// `any`: the two engines answer different shapes and only `ReclaimedSpace` is read.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SystemPruneReport {
    #[serde(rename = "ContainerPruneReports")]
    pub container_prune_reports: Value,
    #[serde(rename = "ImagePruneReports")]
    pub image_prune_reports: Value,
    #[serde(rename = "PodPruneReport")]
    pub pod_prune_report: Value,
    #[serde(rename = "ReclaimedSpace")]
    pub reclaimed_space: i64,
    #[serde(rename = "VolumePruneReports")]
    pub volume_prune_reports: Value,
}
