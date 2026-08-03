//! Which resource fields a client may sort, and where — `runtimes/sort-capabilities.ts`.
//!
//! Per FIELD rather than per resource, because the answer is per field: Docker Engine v1.54 and Podman
//! libpod v5.7.0 both expose filters and limits on their list endpoints and NEITHER exposes a sort or
//! order parameter, so every entry here is `Client` and the map is explicit so a single field can be
//! flipped to `Server` when one of them grows it.
//!
//! Podman's table is Docker's plus the resources only podman has — pods, secrets and machines.

use std::collections::HashMap;

use crate::domain::types::connection::SortMode;

/// The fields both engines list.
const SHARED: &[&str] = &[
    "containers.name",
    "containers.image",
    "containers.pid",
    "containers.state",
    "containers.id",
    "containers.created",
    "images.name",
    "images.registry",
    "images.tag",
    "images.id",
    "images.size",
    "images.containers",
    "images.created",
    "volumes.name",
    "volumes.driver",
    "volumes.created",
    "networks.name",
    "networks.id",
    "networks.driver",
    "networks.interface",
    "networks.internal",
    "networks.dns",
    "networks.created",
];

/// Pods, secrets and machines — podman's alone. A docker connector never lists them, so the field is
/// ABSENT there rather than present and declared unsortable.
const PODMAN_ONLY: &[&str] = &[
    "pods.name",
    "pods.containers",
    "pods.state",
    "pods.id",
    "pods.created",
    "secrets.name",
    "secrets.id",
    "secrets.updated",
    "secrets.created",
    "machines.name",
    "machines.vmType",
    "machines.cpus",
    "machines.memory",
    "machines.diskSize",
    "machines.default",
    "machines.running",
    "machines.lastUp",
    "machines.created",
];

/// The registry surface, which both engines offer.
const REGISTRY: &[&str] = &[
    "registries.search.name",
    "registries.search.registry",
    "registries.search.stars",
    "registries.sources.name",
];

fn table(groups: &[&[&str]]) -> HashMap<String, SortMode> {
    groups
        .iter()
        .flat_map(|group| group.iter())
        .map(|field| ((*field).to_string(), SortMode::Client))
        .collect()
}

/// `DOCKER_SORT_CAPABILITIES`.
pub fn docker() -> HashMap<String, SortMode> {
    table(&[SHARED, REGISTRY])
}

/// `PODMAN_SORT_CAPABILITIES`.
pub fn podman() -> HashMap<String, SortMode> {
    table(&[SHARED, PODMAN_ONLY, REGISTRY])
}
