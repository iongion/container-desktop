//! `types/machine.ts` — the scopes a controller enters.
//!
//! The union is untagged and every member carries a single-value `Type` discriminator, which is
//! what makes it deterministic rather than matched by required-field luck. `SshHost` is the fourth
//! member and lives in [`super::connection`], where the original declares it.

use super::connection::SshHost;

/// Discriminated on `Type`. Rust generates an internally-tagged enum; Go must match the same
/// discriminator.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum ControllerScope {
    PodmanMachine(PodmanMachine),
    WslDistribution(WslDistribution),
    LimaInstance(LimaInstance),
    SshHost(SshHost),
}
impl From<PodmanMachine> for ControllerScope {
    fn from(value: PodmanMachine) -> Self {
        Self::PodmanMachine(value)
    }
}
impl From<WslDistribution> for ControllerScope {
    fn from(value: WslDistribution) -> Self {
        Self::WslDistribution(value)
    }
}
impl From<LimaInstance> for ControllerScope {
    fn from(value: LimaInstance) -> Self {
        Self::LimaInstance(value)
    }
}
impl From<SshHost> for ControllerScope {
    fn from(value: SshHost) -> Self {
        Self::SshHost(value)
    }
}
/// `LimaInstance`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct LimaInstance {
    #[serde(rename = "Arch")]
    pub arch: String,
    #[serde(rename = "CPUs")]
    pub cp_us: String,
    #[serde(rename = "Dir")]
    pub dir: String,
    #[serde(rename = "Disk")]
    pub disk: String,
    #[serde(rename = "Memory")]
    pub memory: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "SSH")]
    pub ssh: String,
    #[serde(rename = "Status")]
    pub status: String,
    /// Discriminator. A single-value enum rather than `const`: typify degrades `const` to an
    /// untyped serde_json::Value, which would leave the untagged union matching by required-field
    /// luck instead of by Type.
    #[serde(rename = "Type")]
    pub type_: LimaInstanceType,
    #[serde(rename = "Usable", default, skip_serializing_if = "Option::is_none")]
    pub usable: Option<bool>,
}
wire_enum! {
    /// Discriminator. A single-value enum rather than `const`: typify degrades `const` to an
    /// untyped serde_json::Value, which would leave the untagged union matching by required-field
    /// luck instead of by Type.
    LimaInstanceType {
        LimaInstance = "LIMAInstance",
    }
}
/// `PodmanMachine`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct PodmanMachine {
    #[serde(rename = "Active")]
    pub active: bool,
    #[serde(rename = "CPUs", default, skip_serializing_if = "Option::is_none")]
    pub cp_us: Option<String>,
    #[serde(rename = "Created")]
    pub created: String,
    #[serde(rename = "Default", default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    #[serde(rename = "DiskSize", default, skip_serializing_if = "Option::is_none")]
    pub disk_size: Option<i64>,
    #[serde(rename = "LastUp")]
    pub last_up: String,
    #[serde(rename = "Memory", default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<i64>,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Running")]
    pub running: bool,
    /// Discriminator. A single-value enum rather than `const`: typify degrades `const` to an
    /// untyped serde_json::Value, which would leave the untagged union matching by required-field
    /// luck instead of by Type.
    #[serde(rename = "Type")]
    pub type_: PodmanMachineType,
    #[serde(rename = "Usable")]
    pub usable: bool,
    #[serde(rename = "VMType")]
    pub vm_type: String,
}
wire_enum! {
    /// Discriminator. A single-value enum rather than `const`: typify degrades `const` to an
    /// untyped serde_json::Value, which would leave the untagged union matching by required-field
    /// luck instead of by Type.
    PodmanMachineType {
        PodmanMachine = "PodmanMachine",
    }
}
/// `WslDistribution`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct WslDistribution {
    #[serde(rename = "Current")]
    pub current: bool,
    #[serde(rename = "Default")]
    pub default: bool,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "State")]
    pub state: String,
    /// Discriminator. A single-value enum rather than `const`: typify degrades `const` to an
    /// untyped serde_json::Value, which would leave the untagged union matching by required-field
    /// luck instead of by Type.
    #[serde(rename = "Type")]
    pub type_: WslDistributionType,
    #[serde(rename = "Usable", default, skip_serializing_if = "Option::is_none")]
    pub usable: Option<bool>,
    #[serde(rename = "Version")]
    pub version: String,
}
wire_enum! {
    /// Discriminator. A single-value enum rather than `const`: typify degrades `const` to an
    /// untyped serde_json::Value, which would leave the untagged union matching by required-field
    /// luck instead of by Type.
    WslDistributionType {
        WslDistribution = "WSLDistribution",
    }
}
