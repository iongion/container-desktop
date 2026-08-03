//! `types/image.ts` — an image, its layers, and the two shapes a container is created from.

//! **The three name lists are `Option`, and that is load-bearing rather than cautious.**
//! `normalizeImage` branches on `image.Names || image.NamesHistory` and on `if (image.RepoTags)`,
//! where an EMPTY array is truthy in JavaScript and an absent one is not — libpod answers `Names`
//! and Docker answers only `RepoTags`, so both arms are live. A `Vec` cannot tell the two apart and
//! the port would take the other branch.

use std::collections::BTreeMap;

use super::container::ContainerInspect;
use super::null_default;

/// `ContainerImage`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerImage {
    #[serde(rename = "Config")]
    pub config: ContainerInspect,
    #[serde(rename = "Containers")]
    pub containers: i64,
    #[serde(rename = "Created")]
    pub created: i64,
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "Digest")]
    pub digest: String,
    /// Computed by [`normalize_image`](crate::domain::normalizers::normalize_image).
    #[serde(rename = "FullName")]
    pub full_name: String,
    /// The app's own field, filled from `/images/{id}/history`. **Never read off a list**, and that
    /// is not tidiness: libpod's image list has a `History` key of its own carrying a list of NAMES,
    /// a different thing that would fail to parse as layers.
    #[serde(rename = "History", skip_deserializing)]
    pub history: Vec<ContainerImageHistory>,
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    pub labels: BTreeMap<String, String>,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Names", skip_serializing_if = "Option::is_none")]
    pub names: Option<Vec<String>>,
    #[serde(rename = "NamesHistory", skip_serializing_if = "Option::is_none")]
    pub names_history: Option<Vec<String>>,
    #[serde(rename = "ParentId")]
    pub parent_id: String,
    #[serde(rename = "Registry")]
    pub registry: String,
    #[serde(rename = "RepoDigests", skip_serializing_if = "Option::is_none")]
    pub repo_digests: Option<Vec<String>>,
    #[serde(rename = "RepoTags", skip_serializing_if = "Option::is_none")]
    pub repo_tags: Option<Vec<String>>,
    #[serde(rename = "SharedSize")]
    pub shared_size: i64,
    #[serde(rename = "Size")]
    pub size: i64,
    #[serde(rename = "Tag")]
    pub tag: String,
    #[serde(rename = "VirtualSize")]
    pub virtual_size: i64,
}
/// One layer of `/images/{id}/history`.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ContainerImageHistory {
    #[serde(rename = "Comment")]
    pub comment: String,
    /// **Neither engine agrees with the original's `string` and they do not agree with each other**:
    /// libpod sends an RFC 3339 timestamp, Docker sends a unix integer. Carried as it arrived.
    #[serde(rename = "Created", alias = "created")]
    pub created: serde_json::Value,
    #[serde(rename = "CreatedBy")]
    pub created_by: String,
    #[serde(rename = "Id", alias = "id")]
    pub id: String,
    #[serde(rename = "Size")]
    pub size: i64,
}
wire_enum! {
    /// `MOUNT_TYPES` — the mount kinds a container may be created with.
    ContainerImageMountType {
        Bind = "bind",
        Tmpfs = "tmpfs",
        Volume = "volume",
        Image = "image",
        Devpts = "devpts",
    }
}
wire_enum! {
    /// `ContainerImageMount.access`
    ContainerImageMountAccess {
        ReadWrite = "rw",
        ReadOnly = "ro",
    }
}
/// `ContainerImageMount` — one mount asked for at creation.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ContainerImageMount {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<ContainerImageMountAccess>,
    pub destination: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    /// A single-value enum rather than a `const`, for the reason
    /// [`LimaInstanceType`](super::machine::LimaInstanceType) is one.
    pub driver: ContainerImageMountDriver,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(rename = "type")]
    pub type_: ContainerImageMountType,
}
wire_enum! {
    /// `ContainerImageMount.driver`
    ContainerImageMountDriver {
        Local = "local",
    }
}
wire_enum! {
    /// `ContainerImagePortMapping.protocol`
    ContainerImagePortProtocol {
        Tcp = "tcp",
        Udp = "udp",
        Sdp = "sdp",
    }
}
/// `ContainerImagePortMapping` — one published port asked for at creation.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ContainerImagePortMapping {
    pub container_port: i64,
    pub guid: String,
    pub host_ip: String,
    pub host_port: i64,
    pub protocol: ContainerImagePortProtocol,
}
