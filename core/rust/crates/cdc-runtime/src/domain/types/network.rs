//! `types/network.ts` — a network, and the proxy, global and per connection.
//!
//! The two halves share a file because the original shares one. The network half is the CANONICAL
//! shape: libpod answers it verbatim and Docker's PascalCase answer is mapped onto it by
//! [`normalize_network`](crate::domain::normalizers::normalize_network).

use super::null_default;
use std::collections::BTreeMap;

/// `Network`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Network {
    pub created: String,
    pub dns_enabled: bool,
    pub driver: String,
    pub id: String,
    pub internal: bool,
    /// **Untyped, where the original declares a string map.** libpod answers one (`{"driver":
    /// "host-local"}`); Docker's normalizer puts the whole `IPAM` object here, which is not one — and
    /// it reaches that field through an `as any`.
    pub ipam_options: serde_json::Value,
    pub ipv6_enabled: bool,
    #[serde(deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    pub name: String,
    pub network_interface: String,
    #[serde(deserialize_with = "null_default")]
    pub options: BTreeMap<String, String>,
    #[serde(deserialize_with = "null_default")]
    pub subnets: Vec<NetworkSubnet>,
}
/// `NetworkSubnet`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct NetworkSubnet {
    pub gateway: String,
    pub lease_range: NetworkSubnetLeaseRange,
    pub subnet: String,
}
/// `NetworkSubnetLeaseRange` — the DHCP window, which Docker has no equivalent of.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct NetworkSubnetLeaseRange {
    pub end_ip: String,
    pub start_ip: String,
}
wire_enum! {
    /// "inherit" uses the global proxy, "override" uses the connection's own config, "off" disables
    /// it for this connection.
    ConnectionProxyMode {
        Inherit = "inherit",
        Override = "override",
        Off = "off",
    }
}
/// `ConnectionProxySettings`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ConnectionProxySettings {
    /// Only meaningful when mode is "override".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<ProxyConfig>,
    pub mode: ConnectionProxyMode,
}
/// `ProxyConfig`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ProxyConfig {
    pub bypass: Vec<String>,
    pub host: String,
    pub mode: ProxyMode,
    pub password: String,
    pub port: i64,
    pub protocol: ProxyProtocol,
    pub username: String,
}
wire_enum! {
    /// `ProxyMode`
    ProxyMode {
        Disabled = "disabled",
        Manual = "manual",
    }
}
wire_enum! {
    /// `ProxyProtocol`
    ProxyProtocol {
        Http = "http",
        Https = "https",
        Socks5 = "socks5",
    }
}
