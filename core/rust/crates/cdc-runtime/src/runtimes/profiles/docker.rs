//! `runtimes/profiles/docker.ts` — Docker's per-(engine, host) leaves.
//!
//! As on the Podman side, the leaves whose bodies are shared with the other engine live in
//! `profiles/shared.rs`: the WSL one is `WslProfile` and the remote one is `SshProfile`.

use std::path::Path;

use async_trait::async_trait;

use crate::domain::ssh::forward::windows_named_pipe_path;
use crate::domain::types::connection::{ApiConnection, EngineConnectorSettings};
use crate::domain::types::engine::ContainerEngineHost;
use crate::domain::types::os::OperatingSystem;
use crate::runtimes::composition::{
    HostContext, HostPlatform, HostProfile, ResolvedApi, UnitResult,
};
use crate::runtimes::profiles::shared::{available_on, available_unless, or_else};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DockerNativeProfile;

#[async_trait]
impl HostProfile for DockerNativeProfile {
    fn host(&self) -> ContainerEngineHost {
        ContainerEngineHost::DockerNative
    }

    fn label(&self) -> &'static str {
        "Docker Native"
    }

    fn is_engine_available(&self, platform: HostPlatform) -> UnitResult<()> {
        available_on(platform, OperatingSystem::Linux, self.host())
    }

    /// `uri = readEngineSocket() || ""` — Docker DISCARDS the seed when the context cannot be read.
    /// The asymmetry with Podman is in the oracle; it is preserved rather than smoothed over, because
    /// the corpus records what the app does.
    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection {
        ApiConnection {
            uri: resolved.socket.to_string(),
            relay: String::new(),
            dial_stdio_command: Vec::new(),
        }
    }
}

/// The pipe Docker Desktop serves its Linux engine on, on a current install.
pub const DOCKER_DESKTOP_PIPE: &str = "dockerDesktopLinuxEngine";

/// What it served before that, and still does on an older one.
pub const DOCKER_ENGINE_PIPE: &str = "docker_engine";

/// Docker Desktop — the vendor's own virtualization.
///
/// **UNSCOPED, and composed with the NATIVE transport.** Podman's vendor host is a machine this app
/// enters; Docker Desktop is a daemon that publishes an endpoint on the host. The two are not
/// symmetric, and reading them as siblings is what would point a Docker Desktop connection at a
/// machine that does not exist.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DockerVendorProfile;

#[async_trait]
impl HostProfile for DockerVendorProfile {
    fn host(&self) -> ContainerEngineHost {
        ContainerEngineHost::DockerVirtualizedVendor
    }

    fn label(&self) -> &'static str {
        "Docker Desktop"
    }

    /// `availableUnless(Linux)` — everywhere except Linux, where the native host is what a user wants.
    /// Not the negation of a single-OS gate: it passes on macOS AND Windows.
    fn is_engine_available(&self, platform: HostPlatform) -> UnitResult<()> {
        available_unless(platform, OperatingSystem::Linux, self.host())
    }

    /// Which pipe this install serves, on Windows — the one thing here that has to be LOOKED at.
    ///
    /// The current pipe if it is there, else the legacy one, whose existence is NOT checked: the
    /// original does not check it either, and an install that has neither leaves the availability check
    /// to refuse an address that answers nothing. Off Windows there is no pipe and no probe.
    async fn probe_uri(
        &self,
        host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> String {
        if host.os_type() != OperatingSystem::WindowsNt {
            return String::new();
        }
        let current = windows_named_pipe_path(DOCKER_DESKTOP_PIPE);
        if host.fs().is_file_present(Path::new(&current)) {
            return current;
        }
        windows_named_pipe_path(DOCKER_ENGINE_PIPE)
    }

    /// Two rankings, one per platform, and the original keeps them apart for a reason.
    ///
    /// On Windows the ENGINE IS NEVER ASKED: `DOCKER_HOST` if the user set one, else the pipe that was
    /// probed. Consulting `docker context inspect` there would answer with whatever context is
    /// selected, which is not necessarily the Linux engine this host means.
    ///
    /// Everywhere else it is the native ranking with the seed KEPT — `socket || seed` — unlike
    /// `docker.native`, which discards it. That asymmetry is the oracle's, in the same file.
    ///
    /// **The relay is absent, and it is the one thing this leaf is missing.** The original reads
    /// `getSystemInfo?.host?.remoteSocket?.path` for it — the engine-EXTENSION surface, which stays
    /// in `container-client` — and nothing here consumes a relay for an unscoped host. A relay a
    /// user configured is preserved by the machine's own merge, so this composes no worse than
    /// `docker.native` does.
    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection {
        let uri = if resolved.os == OperatingSystem::WindowsNt {
            or_else(resolved.seed, resolved.probed)
        } else {
            or_else(resolved.socket, resolved.seed)
        };
        ApiConnection {
            uri,
            relay: String::new(),
            dial_stdio_command: Vec::new(),
        }
    }
}
