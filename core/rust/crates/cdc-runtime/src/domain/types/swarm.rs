//! `types/swarm.ts` — Docker Swarm, which is the Docker surface's alone.
//!
//! Lean by design: only the fields list, inspect and write need. A stack is NOT a REST object — it is
//! derived by grouping services on the `com.docker.stack.namespace` label.

use super::null_default;
use std::collections::BTreeMap;

wire_enum! {
    /// `SwarmNode.Spec.Availability`, and what a node update sets it to.
    SwarmNodeAvailability {
        Active = "active",
        Pause = "pause",
        Drain = "drain",
    }
}
wire_enum! {
    /// `SwarmNode.Spec.Role`, and what a node update sets it to.
    SwarmNodeRole {
        Manager = "manager",
        Worker = "worker",
    }
}
/// The object version every swarm object carries, and the one a write must echo back.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmVersion {
    #[serde(rename = "Index")]
    pub index: i64,
}
/// `GET /swarm` — the cluster spec. A non-empty `ID` means this node is in a swarm.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmInfo {
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "JoinTokens")]
    pub join_tokens: SwarmJoinTokens,
    #[serde(rename = "Spec")]
    pub spec: SwarmSpec,
    #[serde(rename = "UpdatedAt")]
    pub updated_at: String,
    #[serde(rename = "Version")]
    pub version: SwarmVersion,
}
/// `SwarmInfo.JoinTokens`. **Both are secrets** — either one joins a node to the cluster.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmJoinTokens {
    #[serde(rename = "Manager")]
    pub manager: String,
    #[serde(rename = "Worker")]
    pub worker: String,
}
/// The name-and-labels spec shared by the cluster, a secret and a config.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmSpec {
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    #[serde(rename = "Name")]
    pub name: String,
}
/// `SwarmService`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmService {
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "Endpoint")]
    pub endpoint: SwarmServiceEndpoint,
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Spec")]
    pub spec: SwarmServiceSpec,
    #[serde(rename = "UpdatedAt")]
    pub updated_at: String,
    #[serde(rename = "Version")]
    pub version: SwarmVersion,
}
/// `SwarmService.Spec`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmServiceSpec {
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    #[serde(rename = "Mode")]
    pub mode: SwarmServiceMode,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "TaskTemplate")]
    pub task_template: SwarmTaskTemplate,
}
/// `SwarmService.Spec.Mode` — replicated with a count, or global with none.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmServiceMode {
    /// An empty object on the wire; its PRESENCE is the whole meaning.
    #[serde(rename = "Global", skip_serializing_if = "Option::is_none")]
    pub global: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(rename = "Replicated", skip_serializing_if = "Option::is_none")]
    pub replicated: Option<SwarmServiceReplicated>,
}
/// `SwarmService.Spec.Mode.Replicated`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmServiceReplicated {
    #[serde(rename = "Replicas")]
    pub replicas: i64,
}
/// The container spec a service or a task runs, of which only the image is needed here.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmTaskTemplate {
    #[serde(rename = "ContainerSpec")]
    pub container_spec: SwarmContainerSpec,
}
/// `TaskTemplate.ContainerSpec`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmContainerSpec {
    #[serde(rename = "Image")]
    pub image: String,
}
/// `SwarmService.Endpoint`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmServiceEndpoint {
    #[serde(rename = "Ports", deserialize_with = "null_default")]
    pub ports: Vec<SwarmServicePort>,
}
/// `SwarmServicePort`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmServicePort {
    #[serde(rename = "Protocol")]
    pub protocol: String,
    #[serde(rename = "PublishedPort")]
    pub published_port: i64,
    #[serde(rename = "TargetPort")]
    pub target_port: i64,
}
/// `SwarmNode`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmNode {
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "Description")]
    pub description: SwarmNodeDescription,
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "ManagerStatus")]
    pub manager_status: SwarmManagerStatus,
    #[serde(rename = "Spec")]
    pub spec: SwarmNodeSpec,
    #[serde(rename = "Status")]
    pub status: SwarmNodeStatus,
    #[serde(rename = "UpdatedAt")]
    pub updated_at: String,
    #[serde(rename = "Version")]
    pub version: SwarmVersion,
}
/// `SwarmNode.Spec`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmNodeSpec {
    #[serde(rename = "Availability", skip_serializing_if = "Option::is_none")]
    pub availability: Option<SwarmNodeAvailability>,
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    #[serde(rename = "Role", skip_serializing_if = "Option::is_none")]
    pub role: Option<SwarmNodeRole>,
}
/// `SwarmNode.Description`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmNodeDescription {
    #[serde(rename = "Engine")]
    pub engine: SwarmNodeEngine,
    #[serde(rename = "Hostname")]
    pub hostname: String,
    #[serde(rename = "Platform")]
    pub platform: SwarmNodePlatform,
    #[serde(rename = "Resources")]
    pub resources: SwarmNodeResources,
}
/// `SwarmNode.Description.Engine`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmNodeEngine {
    #[serde(rename = "EngineVersion")]
    pub engine_version: String,
}
/// `SwarmNode.Description.Platform`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmNodePlatform {
    #[serde(rename = "Architecture")]
    pub architecture: String,
    #[serde(rename = "OS")]
    pub os: String,
}
/// `SwarmNode.Description.Resources`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmNodeResources {
    #[serde(rename = "MemoryBytes")]
    pub memory_bytes: i64,
    #[serde(rename = "NanoCPUs")]
    pub nano_cpus: i64,
}
/// `SwarmNode.Status`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmNodeStatus {
    #[serde(rename = "Addr")]
    pub addr: String,
    #[serde(rename = "State")]
    pub state: String,
}
/// `SwarmNode.ManagerStatus`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmManagerStatus {
    #[serde(rename = "Addr")]
    pub addr: String,
    #[serde(rename = "Leader")]
    pub leader: bool,
    #[serde(rename = "Reachability")]
    pub reachability: String,
}
/// `SwarmTask`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmTask {
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "DesiredState")]
    pub desired_state: String,
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "NodeID")]
    pub node_id: String,
    #[serde(rename = "ServiceID")]
    pub service_id: String,
    #[serde(rename = "Slot")]
    pub slot: i64,
    #[serde(rename = "Spec")]
    pub spec: SwarmTaskTemplate,
    #[serde(rename = "Status")]
    pub status: SwarmTaskStatus,
}
/// `SwarmTask.Status`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmTaskStatus {
    #[serde(rename = "Message")]
    pub message: String,
    #[serde(rename = "State")]
    pub state: String,
    #[serde(rename = "Timestamp")]
    pub timestamp: String,
}
/// Derived, not a REST object: one entry per `com.docker.stack.namespace` across services.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmStack {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Orchestrator")]
    pub orchestrator: String,
    #[serde(rename = "Services")]
    pub services: i64,
}
/// `SwarmSecret`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmSecret {
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Spec")]
    pub spec: SwarmSpec,
    #[serde(rename = "UpdatedAt")]
    pub updated_at: String,
    #[serde(rename = "Version")]
    pub version: SwarmVersion,
}
/// `SwarmConfig`. Unlike a secret, its `Data` comes back on a read.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmConfig {
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Spec")]
    pub spec: SwarmConfigSpec,
    #[serde(rename = "UpdatedAt")]
    pub updated_at: String,
    #[serde(rename = "Version")]
    pub version: SwarmVersion,
}
/// `SwarmConfig.Spec`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmConfigSpec {
    #[serde(rename = "Data")]
    pub data: String,
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    #[serde(rename = "Name")]
    pub name: String,
}
/// `SwarmInitOptions`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmInitOptions {
    #[serde(rename = "AdvertiseAddr", skip_serializing_if = "Option::is_none")]
    pub advertise_addr: Option<String>,
    #[serde(rename = "ForceNewCluster", skip_serializing_if = "Option::is_none")]
    pub force_new_cluster: Option<bool>,
    #[serde(rename = "ListenAddr", skip_serializing_if = "Option::is_none")]
    pub listen_addr: Option<String>,
}
/// `SwarmLeaveOptions`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmLeaveOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}
/// One of this machine's interface addresses — a candidate `--advertise-addr`.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct HostAddress {
    pub address: String,
    pub iface: String,
}
/// A node availability or role change, applied onto the node's current spec.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct NodeUpdateOptions {
    #[serde(rename = "Availability", skip_serializing_if = "Option::is_none")]
    pub availability: Option<SwarmNodeAvailability>,
    #[serde(rename = "Role", skip_serializing_if = "Option::is_none")]
    pub role: Option<SwarmNodeRole>,
}
/// `SwarmSecretCreateOptions`. `Data` is the RAW value; the adapter base64-encodes it.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmSecretCreateOptions {
    #[serde(rename = "Data")]
    pub data: String,
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    #[serde(rename = "Name")]
    pub name: String,
}
/// `SwarmConfigCreateOptions`. `Data` is the RAW value; the adapter base64-encodes it.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SwarmConfigCreateOptions {
    #[serde(rename = "Data")]
    pub data: String,
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    #[serde(rename = "Name")]
    pub name: String,
}
