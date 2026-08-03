//! `types/container.ts` — a container as the two engines list and inspect it.
//!
//! Three rules hold across this module, and each was measured against real podman 5.7.0 and real
//! Docker 29.7.0 rather than read off the original's declarations. They are argued in
//!:
//!
//! 1. every field is `#[serde(default)]` — the original's interfaces are structural and nothing
//!    validates them, so a required field would refuse an answer a real engine sends;
//! 2. every COLLECTION is `null`-tolerant — podman answers `"Labels": null`, Docker answers
//!    `"Ports": null` on a stopped container, and a bare `Vec` or map refuses both;
//! 3. a field the two surfaces answer with different JSON TYPES is carried as it arrived.

use std::collections::BTreeMap;

use serde_json::Value;

use super::{null_default, null_tolerant_map};

wire_enum! {
    /// libpod/define/podstate.go, as the original names it. **The engines answer values outside it** —
    /// Docker sends `restarting` and `removing`, podman sends `configured` and `stopping` — so what
    /// carries an engine's answer is a `String` and this is the vocabulary a RULE compares against.
    ContainerStateList {
        Created = "created",
        Error = "error",
        Exited = "exited",
        Paused = "paused",
        Running = "running",
        Degraded = "degraded",
        Stopped = "stopped",
    }
}
wire_enum! {
    /// What a healthcheck last said. Absent when the container has none.
    ContainerHealth {
        Healthy = "healthy",
        Unhealthy = "unhealthy",
        Starting = "starting",
    }
}
/// `Container`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Container {
    #[serde(rename = "AutoRemove")]
    pub auto_remove: bool,
    /// **libpod answers an ARGV and Docker answers a COMMAND LINE** — `["httpd-foreground"]` against
    /// `"sleep infinity"`. Carried as it arrived; the original declares `string[]` and is wrong about
    /// one of the two engines.
    #[serde(rename = "Command")]
    pub command: Value,
    #[serde(rename = "Computed")]
    pub computed: ContainerComputed,
    /// `null` on podman's COMPAT list — which is the route `adapters::containers::list` uses, so
    /// without this the whole list refuses to parse. Measured on 5.7.0.
    #[serde(rename = "Config", deserialize_with = "null_default")]
    pub config: ContainerInspect,
    /// **libpod answers an RFC 3339 timestamp and Docker answers a unix integer.** Same rule as
    /// `Command`.
    #[serde(rename = "Created")]
    pub created: Value,
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "ExitCode")]
    pub exit_code: i64,
    #[serde(rename = "Exited")]
    pub exited: bool,
    #[serde(rename = "ExitedAt")]
    pub exited_at: i64,
    #[serde(rename = "HostConfig", skip_serializing_if = "Option::is_none")]
    pub host_config: Option<ContainerHostConfig>,
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "Image")]
    pub image: String,
    /// Prefixed by `sha256:` on the Docker surface.
    #[serde(rename = "ImageID")]
    pub image_id: String,
    #[serde(rename = "ImageName", skip_serializing_if = "Option::is_none")]
    pub image_name: Option<String>,
    #[serde(rename = "IsInfra")]
    pub is_infra: bool,
    #[serde(rename = "Kube", skip_serializing_if = "Option::is_none")]
    pub kube: Option<String>,
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    /// The DECODED log text, which is a consumer's answer rather than a carrier's — the bytes travel
    /// as [`HttpStream`](crate::capabilities::http::HttpStream) chunks and are not decoded on the way.
    #[serde(rename = "Logs", skip_serializing_if = "Option::is_none")]
    pub logs: Option<String>,
    #[serde(rename = "Mounts", deserialize_with = "null_default")]
    pub mounts: Vec<Value>,
    #[serde(rename = "Name", skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "Names", deserialize_with = "null_default")]
    pub names: Vec<String>,
    #[serde(rename = "Namespaces")]
    pub namespaces: Value,
    #[serde(rename = "NetworkSettings", skip_serializing_if = "Option::is_none")]
    pub network_settings: Option<ContainerNetworkSettings>,
    /// libpod answers a list of network NAMES here; Docker puts its per-network detail under
    /// `NetworkSettings.Networks` instead. Untyped in the original and untyped here.
    #[serde(rename = "Networks")]
    pub networks: Value,
    #[serde(rename = "Pid")]
    pub pid: i64,
    #[serde(rename = "Pod")]
    pub pod: String,
    #[serde(rename = "PodName")]
    pub pod_name: String,
    /// **A LIST, where the original declares a map.** Every consumer of it indexes and measures it as
    /// an array, and `normalizeContainer` assigns `[]` to it; the map was the declaration and never
    /// the shape. Fixed in the TypeScript in the same change set.
    #[serde(rename = "Ports", deserialize_with = "null_default")]
    pub ports: Vec<ContainerPort>,
    #[serde(rename = "Processes", deserialize_with = "null_default")]
    pub processes: Vec<Value>,
    #[serde(rename = "Size")]
    pub size: Value,
    #[serde(rename = "StartedAt")]
    pub started_at: i64,
    #[serde(rename = "State")]
    pub state: ContainerStateField,
    #[serde(rename = "Stats", skip_serializing_if = "Option::is_none")]
    pub stats: Option<ContainerStats>,
    #[serde(rename = "Status")]
    pub status: String,
}
impl Container {
    /// `isContainerRunning` — the decoded state when there is one, else whatever `State` carries.
    ///
    /// The two fallbacks are not symmetric in the original and are not made so here: an inspect's
    /// `Running` flag counts on its own, and only the bare word is lowercased.
    pub fn is_running(&self) -> bool {
        let running = ContainerStateList::Running.as_str();
        if !self.computed.decoded_state.is_empty() {
            return self.computed.decoded_state == running;
        }
        match &self.state {
            ContainerStateField::Detail(state) => state.running || state.status == running,
            ContainerStateField::Summary(word) => word.to_lowercase() == running,
        }
    }
}
/// A list answers `State` as a word and an inspect answers it as an object. Untagged, and ordered so
/// the object is tried first: a string can only be the word.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum ContainerStateField {
    Detail(Box<ContainerState>),
    Summary(String),
}
impl Default for ContainerStateField {
    fn default() -> Self {
        Self::Summary(String::new())
    }
}
impl ContainerStateField {
    /// The word either shape names, which is what `normalizeContainer` decodes to `DecodedState`.
    pub fn word(&self) -> &str {
        match self {
            Self::Detail(state) => &state.status,
            Self::Summary(word) => word,
        }
    }

    /// What an INSPECT's own health block last said, when there is one. A list has none, and a
    /// container without a healthcheck has none either — see [`ContainerState::health`].
    pub fn health_status(&self) -> Option<String> {
        match self {
            Self::Detail(state) => state.health.as_ref().map(|health| health.status.clone()),
            Self::Summary(_) => None,
        }
    }
}
/// What the port COMPUTES onto a container — `Container.Computed`, populated by
/// [`normalize_container`](crate::domain::normalizers::normalize_container).
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerComputed {
    /// The engine's own word, verbatim. Not [`ContainerStateList`]: the engines answer outside it.
    #[serde(rename = "DecodedState")]
    pub decoded_state: String,
    #[serde(rename = "Group", skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(rename = "Health", skip_serializing_if = "Option::is_none")]
    pub health: Option<ContainerHealth>,
    #[serde(rename = "Name", skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "NameInGroup", skip_serializing_if = "Option::is_none")]
    pub name_in_group: Option<String>,
}
/// `ContainerInspect` — the image config a container was created from.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerInspect {
    #[serde(rename = "Cmd", deserialize_with = "null_default")]
    pub cmd: Vec<String>,
    #[serde(rename = "Env", deserialize_with = "null_default")]
    pub env: Vec<String>,
    #[serde(rename = "ExposedPorts", deserialize_with = "null_default")]
    pub exposed_ports: serde_json::Map<String, Value>,
    #[serde(rename = "StopSignal")]
    pub stop_signal: String,
    #[serde(rename = "WorkDir")]
    pub work_dir: String,
}
/// `ContainerState` — the inspect shape.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerState {
    #[serde(rename = "Dead")]
    pub dead: bool,
    #[serde(rename = "Error")]
    pub error: String,
    #[serde(rename = "ExitCode")]
    pub exit_code: i64,
    #[serde(rename = "FinishedAt")]
    pub finished_at: String,
    /// Docker's inspect spells the healthcheck `Health`; podman's spells it `Healthcheck`. The
    /// original declares only the second and READS only the first, through a cast. Both are carried.
    ///
    /// **`Option`, and the absence is load-bearing**: the normalizer falls back to the list `Status`
    /// with `??`, which fires on an ABSENT health block and not on a present one whose status is
    /// empty. Measured — neither engine sends the block at all for a container without a healthcheck.
    #[serde(rename = "Health", skip_serializing_if = "Option::is_none")]
    pub health: Option<ContainerHealthcheck>,
    #[serde(rename = "Healthcheck", deserialize_with = "null_default")]
    pub healthcheck: ContainerHealthcheck,
    #[serde(rename = "OOMKilled")]
    pub oom_killed: bool,
    #[serde(rename = "OciVersion")]
    pub oci_version: String,
    #[serde(rename = "Paused")]
    pub paused: bool,
    #[serde(rename = "Pid")]
    pub pid: i64,
    #[serde(rename = "Restarting")]
    pub restarting: bool,
    #[serde(rename = "Running")]
    pub running: bool,
    #[serde(rename = "StartedAt")]
    pub started_at: String,
    /// The engine's own word. See [`ContainerComputed::decoded_state`].
    #[serde(rename = "Status")]
    pub status: String,
}
/// `ContainerState.Healthcheck`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerHealthcheck {
    #[serde(rename = "FailingStreak")]
    pub failing_streak: i64,
    #[serde(rename = "Log")]
    pub log: Value,
    #[serde(rename = "Status")]
    pub status: String,
}
/// `ContainerPort`. **Three spellings of each field collapse into one**, which is what `serde`'s
/// `alias` is for: the original declares all nine because it cannot, and every consumer of it is a
/// `??` chain over the alternatives. libpod's snake spelling is the one written back.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerPort {
    #[serde(alias = "containerPort", alias = "PrivatePort")]
    pub container_port: i64,
    #[serde(alias = "hostIP", alias = "IP")]
    pub host_ip: String,
    #[serde(alias = "hostPort", alias = "PublicPort")]
    pub host_port: i64,
    #[serde(alias = "Type")]
    pub protocol: String,
    pub range: i64,
}
/// `ContainerNetworkSettingsPorts`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerNetworkSettingsPort {
    #[serde(rename = "HostIp")]
    pub host_ip: String,
    #[serde(rename = "HostPort")]
    pub host_port: String,
}
/// `ContainerNetworkSettings`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerNetworkSettings {
    #[serde(rename = "Bridge")]
    pub bridge: String,
    #[serde(rename = "EndpointID")]
    pub endpoint_id: String,
    #[serde(rename = "Gateway")]
    pub gateway: String,
    #[serde(rename = "GlobalIPv6Address")]
    pub global_ipv6_address: String,
    #[serde(rename = "GlobalIPv6PrefixLen")]
    pub global_ipv6_prefix_len: i64,
    #[serde(rename = "HairpinMode")]
    pub hairpin_mode: bool,
    #[serde(rename = "IPAddress")]
    pub ip_address: String,
    #[serde(rename = "IPPrefixLen")]
    pub ip_prefix_len: i64,
    #[serde(rename = "IPv6Gateway")]
    pub ipv6_gateway: String,
    #[serde(rename = "LinkLocalIPv6Address")]
    pub link_local_ipv6_address: String,
    #[serde(rename = "LinkLocalIPv6PrefixLen")]
    pub link_local_ipv6_prefix_len: i64,
    #[serde(rename = "MacAddress")]
    pub mac_address: String,
    /// A port that is exposed and bound to nothing is a `null` VALUE, not an empty list — see
    /// `null_tolerant_map`.
    #[serde(rename = "Ports", deserialize_with = "null_tolerant_map")]
    pub ports: BTreeMap<String, Vec<ContainerNetworkSettingsPort>>,
    #[serde(rename = "SandboxID")]
    pub sandbox_id: String,
    #[serde(rename = "SandboxKey")]
    pub sandbox_key: String,
}
/// `ContainerHostConfig`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerHostConfig {
    /// **The same element shape `NetworkSettings.Ports` carries, NOT a [`ContainerPort`].** Both
    /// engines answer `{"80/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18899"}]}` here — measured
    /// against a container that actually publishes a port. `ContainerPort`'s aliases do not cover
    /// those two spellings, so the wrong type did not refuse: it read every binding as zeroes, and a
    /// reachability check would have reported nothing published. Null values, same rule as above.
    #[serde(rename = "PortBindings", deserialize_with = "null_tolerant_map")]
    pub port_bindings: BTreeMap<String, Vec<ContainerNetworkSettingsPort>>,
    #[serde(rename = "Runtime")]
    pub runtime: String,
}
/// `ContainerConnectOptions` — opening a shell in a container. Not a REST call; the original reaches
/// the host application surface for it.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerConnectOptions {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    pub title: String,
}
/// `ContainerStats`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerStats {
    /// **Lowercase on the wire**, where the original declares `Id`. Measured: real podman answers
    /// `"id"` and `"name"` on the stats route, as Docker's compat route does. Fixed in the
    /// TypeScript in the same change set; the alias keeps the declared spelling readable.
    #[serde(alias = "Id")]
    pub id: String,
    pub blkio_stats: ContainerBlkioStats,
    pub cpu_stats: ContainerCpuStats,
    pub memory_stats: ContainerMemoryStats,
    pub name: String,
    /// **Keyed by INTERFACE, where the original declares a single key literally named `network`.**
    /// Nothing reads it in either tree; it is typed by what the engines send. Fixed in the
    /// TypeScript in the same change set.
    #[serde(deserialize_with = "null_default")]
    pub networks: BTreeMap<String, ContainerNetworkStats>,
    pub num_procs: i64,
    pub pids_stats: Value,
    /// The previous sample, whose fields the original marks optional. One shape serves both, because
    /// `#[serde(default)]` already makes every field of it optional on the wire.
    pub precpu_stats: ContainerCpuStats,
    pub preread: String,
    pub read: String,
    pub storage_stats: Value,
}
/// `ContainerStats.blkio_stats`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerBlkioStats {
    pub io_merged_recursive: Value,
    pub io_queue_recursive: Value,
    #[serde(deserialize_with = "null_default")]
    pub io_service_bytes_recursive: Vec<Value>,
    pub io_service_time_recursive: Value,
    pub io_serviced_recursive: Value,
    pub io_time_recursive: Value,
    pub io_wait_time_recursive: Value,
    pub sectors_recursive: Value,
}
/// `ContainerStats.cpu_stats`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerCpuStats {
    pub cpu: f64,
    pub cpu_usage: ContainerCpuUsage,
    pub online_cpus: i64,
    pub system_cpu_usage: i64,
    pub throttling_data: ContainerThrottlingData,
}
/// `ContainerStats.cpu_stats.cpu_usage`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerCpuUsage {
    #[serde(deserialize_with = "null_default")]
    pub percpu_usage: Vec<i64>,
    pub total_usage: i64,
    pub usage_in_kernelmode: i64,
    pub usage_in_usermode: i64,
}
/// `ContainerStats.cpu_stats.throttling_data`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerThrottlingData {
    pub periods: i64,
    pub throttled_periods: i64,
    pub throttled_time: i64,
}
/// `ContainerStats.memory_stats`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerMemoryStats {
    pub limit: i64,
    pub max_usage: i64,
    pub usage: i64,
}
/// One interface's counters inside `ContainerStats.networks`.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerNetworkStats {
    pub rx_bytes: i64,
    pub rx_dropped: i64,
    pub rx_errors: i64,
    pub rx_packets: i64,
    pub tx_bytes: i64,
    pub tx_dropped: i64,
    pub tx_errors: i64,
    pub tx_packets: i64,
}
