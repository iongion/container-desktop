//! `compose/labels.ts` — the labels a stack is stamped with, and read back by.
//!
//! One source, shared by whoever writes them and whoever groups by them: grouping and orchestration
//! cannot drift apart if there is one spelling of each.

/// `com.docker.compose.project`
pub const LABEL_PROJECT: &str = "com.docker.compose.project";
/// `com.docker.compose.service`
pub const LABEL_SERVICE: &str = "com.docker.compose.service";
/// `com.docker.compose.container-number`
pub const LABEL_CONTAINER_NUMBER: &str = "com.docker.compose.container-number";
/// `com.docker.compose.config-hash`
pub const LABEL_CONFIG_HASH: &str = "com.docker.compose.config-hash";
/// `com.docker.compose.network`
pub const LABEL_NETWORK: &str = "com.docker.compose.network";
/// `com.docker.compose.volume`
pub const LABEL_VOLUME: &str = "com.docker.compose.volume";
/// `io.podman.compose.project`
pub const LABEL_PODMAN_PROJECT: &str = "io.podman.compose.project";
/// `io.podman.compose.service`
pub const LABEL_PODMAN_SERVICE: &str = "io.podman.compose.service";

/// The keys that name a container's owning project — either engine's convention.
pub const COMPOSE_PROJECT_LABELS: &[&str] = &[LABEL_PROJECT, LABEL_PODMAN_PROJECT];
/// The keys that name its service. Both, so a stack made by podman-compose is recognised.
pub const COMPOSE_SERVICE_LABELS: &[&str] = &[LABEL_SERVICE, LABEL_PODMAN_SERVICE];
