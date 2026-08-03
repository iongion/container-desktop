//! `adapters/baseUrls.ts` — the two REST roots, as PATH PREFIXES.
//!
//! The authority half of `LIBPOD_BASE_URL` / `DOCKER_BASE_URL` is already the `Host` header
//! `machine::proxy::api_headers` derives from the connection's `api.baseURL`, so only the prefix is
//! left. Most calls use NEITHER: the original overrides `baseURL` only for volumes, secrets, networks,
//! pods, `system/df` and creation — everything else goes to the connection's own root, which on Podman
//! is `http://d` and therefore the Docker-COMPAT routes.

use std::time::Duration;

pub const LIBPOD_PATH_PREFIX: &str = "/v4.0.0/libpod";

/// Docker's root has no prefix. A constant so selecting one is a table, not an `if docker`.
pub const DOCKER_PATH_PREFIX: &str = "";

/// Stop, restart, force-remove and stack teardown: the engine waits out the container's grace period
/// server-side, so the host's 3s default would report failure while it is still working.
pub const LIFECYCLE_TIMEOUT: Duration = Duration::from_secs(60);
