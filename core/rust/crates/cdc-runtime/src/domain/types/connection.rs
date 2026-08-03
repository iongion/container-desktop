//! `types/connection.ts` — a connection, its settings, and what a connector is.
//!
//! `SortMode`, `ResourceCapabilities`, `ExtensionFlags` and `EngineExtension` are here because the
//! original declares all four INLINE inside `ConnectorCapabilities` (`connection.ts:107-124`);
//! `EngineExtension` is additionally named in `runtimes/facade.ts`, which is the same union.
//! `SettingsMode` is the inline `mode: "mode.automatic" | "mode.manual"` on
//! `EngineConnectorSettings`, and `SSHHost` is declared here rather than in `machine.ts` — the
//! original's placement, kept.

use super::engine::{
    ContainerEngine, ContainerEngineHost, Controller, EngineConnectorAvailability, Program,
};
use super::machine::ControllerScope;
use super::network::ConnectionProxySettings;
use super::registry::{CertAuthority, RegistryTrustEntry};
use super::resource_sync_protocol::ConnectOrigin;

/// `ApiConnection`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ApiConnection {
    /// Set when the engine API cannot be ssh -NL forwarded (a Windows named pipe, or a Podman
    /// machine socket inside a VM). Mutually exclusive with the forwarded-relay strategy.
    #[serde(
        rename = "dialStdioCommand",
        default,
        skip_serializing_if = "Vec::is_empty"
    )]
    pub dial_stdio_command: Vec<String>,
    /// The in-guest socket the local uri forwards to. Empty when there is no relay.
    pub relay: String,
    /// The engine API socket, pipe, or the LOCAL end of an ssh -NL forward.
    pub uri: String,
}
/// `ConnectOptions`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ConnectOptions {
    pub connection: Connection,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<ConnectOrigin>,
    #[serde(rename = "skipAvailabilityCheck")]
    pub skip_availability_check: bool,
    #[serde(rename = "startApi")]
    pub start_api: bool,
}
/// Persisted in user-settings.json under `connections`. additionalProperties is deliberately open:
/// a settings write must not delete keys a newer app version added.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct Connection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    pub engine: ContainerEngine,
    pub host: ContainerEngineHost,
    /// Shape is `host.<instance>.<host>`, e.g. host.default.podman.native or
    /// `host.<uuid>.docker.remote`. The trailing segment is the ContainerEngineHost value. NOT
    /// expressed as a `pattern`: typify compiled patterns into a LazyLock regex, which needed a
    /// Rust newer than the MSRV this workspace declared when the type was written. The generator
    /// has since been withdrawn and these types are hand-written, so the pattern is not coming back
    /// by itself; the shape is pinned by the tests instead.
    pub id: String,
    pub label: String,
    #[serde(rename = "logLevel", default, skip_serializing_if = "Option::is_none")]
    pub log_level: Option<String>,
    pub name: String,
    /// True for the synthesized system-default.* connections and for env-seeded dev remotes —
    /// neither is persisted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readonly: Option<bool>,
    pub settings: EngineConnectorSettings,
}
/// A Connection plus what detection found. NOT persisted — it is rebuilt on every connect.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct Connector {
    pub availability: EngineConnectorAvailability,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ConnectorCapabilities>,
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    pub engine: ContainerEngine,
    pub host: ContainerEngineHost,
    pub id: String,
    pub label: String,
    #[serde(rename = "logLevel", default, skip_serializing_if = "Option::is_none")]
    pub log_level: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readonly: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scopes: Vec<ControllerScope>,
    pub settings: EngineConnectorSettings,
}
/// `ConnectorCapabilities`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ConnectorCapabilities {
    pub events: bool,
    pub extensions: ExtensionFlags,
    pub resources: ResourceCapabilities,
    /// Per-field sort capability. REST list endpoints stay explicit "client" entries until an API
    /// exposes sorting.
    pub sort: std::collections::HashMap<String, SortMode>,
}
/// `DialStdioBridge`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct DialStdioBridge {
    pub command: Vec<String>,
    /// Stable, non-empty id for this bridge — the transport's cache key.
    pub relay: DialStdioBridgeRelay,
}
/// Stable, non-empty id for this bridge — the transport's cache key.
#[derive(serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct DialStdioBridgeRelay(String);
impl std::ops::Deref for DialStdioBridgeRelay {
    type Target = String;
    fn deref(&self) -> &String {
        &self.0
    }
}
impl From<DialStdioBridgeRelay> for String {
    fn from(value: DialStdioBridgeRelay) -> Self {
        value.0
    }
}
impl std::str::FromStr for DialStdioBridgeRelay {
    type Err = super::error::ConversionError;
    fn from_str(value: &str) -> Result<Self, super::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl<'de> serde::Deserialize<'de> for DialStdioBridgeRelay {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer)?
            .parse()
            .map_err(|e: super::error::ConversionError| {
                <D::Error as serde::de::Error>::custom(e.to_string())
            })
    }
}
/// `DisconnectOptions`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct DisconnectOptions {
    pub connection: Connection,
    #[serde(rename = "stopApi")]
    pub stop_api: bool,
}
/// `EngineConnectorApiSettings`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct EngineConnectorApiSettings {
    /// Per-connection override. Unset means inherit GlobalUserSettings.reconnect.enabled.
    #[serde(
        rename = "autoReconnect",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub auto_reconnect: Option<bool>,
    #[serde(rename = "autoStart", default, skip_serializing_if = "Option::is_none")]
    pub auto_start: Option<bool>,
    /// "http://d" for Podman, "http://localhost" for Docker and Apple. Not cosmetic — it selects
    /// the Host header the daemon expects.
    #[serde(rename = "baseURL")]
    pub base_url: String,
    pub connection: ApiConnection,
}
/// `EngineConnectorSettings`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct EngineConnectorSettings {
    pub api: EngineConnectorApiSettings,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub certificates: Vec<CertAuthority>,
    /// The engine CONTEXT this connection is pinned to. Absent means the CLI's current
    /// context, which is what every connection did before pinning existed — and what lets an
    /// out-of-band `docker context use` silently repoint one. Ignored by an engine that has no
    /// contexts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller: Option<Controller>,
    pub mode: SettingsMode,
    pub program: Program,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<ConnectionProxySettings>,
    /// The app's MANAGED set only. Writers read-modify-write registries.conf and never wipe user or
    /// system entries.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub registries: Vec<RegistryTrustEntry>,
    pub rootfull: bool,
}
wire_enum! {
    /// An extension group that is either real or a no-op on a given host.
    EngineExtension {
        Machines = "machines",
        Kube = "kube",
        Contexts = "contexts",
        Swarm = "swarm",
        Builders = "builders",
        Compose = "compose",
        Registries = "registries",
        RegistryTrust = "registryTrust",
        ControllerVersion = "controllerVersion",
    }
}
/// One flag per EngineExtension. All are required: absence would be indistinguishable from false,
/// and the symmetry rule is that every host answers for every extension.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ExtensionFlags {
    pub builders: bool,
    pub compose: bool,
    pub contexts: bool,
    #[serde(rename = "controllerVersion")]
    pub controller_version: bool,
    pub kube: bool,
    pub machines: bool,
    pub registries: bool,
    #[serde(rename = "registryTrust")]
    pub registry_trust: bool,
    pub swarm: bool,
}
/// `ResourceCapabilities`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ResourceCapabilities {
    pub networks: bool,
    pub pods: bool,
    pub secrets: bool,
}
wire_enum! {
    /// `SettingsMode`
    SettingsMode {
        ModeAutomatic = "mode.automatic",
        ModeManual = "mode.manual",
    }
}
wire_enum! {
    /// `SortMode`
    SortMode {
        Client = "client",
        Server = "server",
    }
}
/// Note `Host` is the ~/.ssh/config alias or literal host as written, while `HostName` is what it
/// resolves to. `ConfigHost`, when set, suppresses both -i and -p in the ssh argv.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct SshHost {
    #[serde(
        rename = "ConfigHost",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub config_host: Option<String>,
    #[serde(rename = "Connected", default, skip_serializing_if = "Option::is_none")]
    pub connected: Option<bool>,
    #[serde(rename = "Host")]
    pub host: String,
    #[serde(rename = "HostName")]
    pub host_name: String,
    #[serde(rename = "IdentityFile")]
    pub identity_file: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Port")]
    pub port: i64,
    /// Discriminator. A single-value enum rather than `const`: typify degrades `const` to an
    /// untyped serde_json::Value, which would leave the untagged union matching by required-field
    /// luck instead of by Type.
    #[serde(rename = "Type")]
    pub type_: SshHostType,
    #[serde(rename = "Usable", default, skip_serializing_if = "Option::is_none")]
    pub usable: Option<bool>,
    #[serde(rename = "User")]
    pub user: String,
}
wire_enum! {
    /// Discriminator. A single-value enum rather than `const`: typify degrades `const` to an
    /// untyped serde_json::Value, which would leave the untagged union matching by required-field
    /// luck instead of by Type.
    SshHostType {
        SshConnection = "SSHConnection",
    }
}
/// An entry from `podman system connection list`.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct SystemConnection {
    #[serde(rename = "Identity")]
    pub identity: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "URI")]
    pub uri: String,
}
