//! `types/pod.ts` — a pod, which is libpod's alone.

use std::collections::BTreeMap;

use super::null_default;
use serde_json::Value;

wire_enum! {
    /// The pod states libpod names. Capitalised, unlike a container's — that is the engine's
    /// spelling and not an inconsistency to tidy. What carries an engine's answer is a `String`, for
    /// the reason [`ContainerStateList`](super::container::ContainerStateList) gives.
    PodStatusList {
        Created = "Created",
        Error = "Error",
        Exited = "Exited",
        Paused = "Paused",
        Running = "Running",
        Degraded = "Degraded",
        Stopped = "Stopped",
        Dead = "Dead",
    }
}
/// `Pod`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Pod {
    #[serde(rename = "Cgroup")]
    pub cgroup: String,
    /// `PodContainer` is `any` in the original and stays untyped here: a pod's member list is a
    /// different shape on list (`{Id, Names, Status}`) than on inspect (a whole container).
    #[serde(rename = "Containers", deserialize_with = "null_default")]
    pub containers: Vec<Value>,
    #[serde(rename = "Created")]
    pub created: String,
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "InfraId")]
    pub infra_id: String,
    #[serde(rename = "Kube", skip_serializing_if = "Option::is_none")]
    pub kube: Option<String>,
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    /// The DECODED log text. See [`Container::logs`](super::container::Container::logs).
    #[serde(rename = "Logs", skip_serializing_if = "Option::is_none")]
    pub logs: Option<super::host::ProgramOutput>,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "NameSpace")]
    pub name_space: String,
    #[serde(rename = "Networks", deserialize_with = "null_default")]
    pub networks: Vec<String>,
    #[serde(rename = "NumContainers")]
    pub num_containers: i64,
    /// A string, not a number: libpod answers the infra container's pid as text.
    #[serde(rename = "Pid")]
    pub pid: String,
    /// Filled by a second call, as `History` is on an image.
    #[serde(rename = "Processes")]
    pub processes: PodProcessReport,
    #[serde(rename = "Status")]
    pub status: String,
}
impl Pod {
    /// Whether libpod calls this pod running, which is the one state a caller acts on.
    pub fn is_running(&self) -> bool {
        self.status == PodStatusList::Running.as_str()
    }
}
/// `/pods/{id}/top`.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct PodProcessReport {
    /// **A row per process, a cell per column** — the original declares a flat `string[]`, and
    /// libpod answers `[][]string`. Its own container-top reader already patches around that.
    #[serde(rename = "Processes", deserialize_with = "null_default")]
    pub processes: Vec<Vec<String>>,
    #[serde(rename = "Titles", deserialize_with = "null_default")]
    pub titles: Vec<String>,
}
