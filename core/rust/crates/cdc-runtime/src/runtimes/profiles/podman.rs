//! `runtimes/profiles/podman.ts` — Podman's per-(engine, host) leaves.
//!
//! The two Podman hosts whose profile is shared with Docker are not here: the WSL leaf is
//! [`crate::runtimes::profiles::shared::WslProfile`] and the remote one is `SshProfile`, both because
//! the original's two copies differ in nothing but the host they name.

use async_trait::async_trait;

use crate::domain::ssh::forward::is_named_pipe;
use crate::domain::types::connection::{ApiConnection, ConnectorCapabilities, ExtensionFlags};
use crate::domain::types::engine::ContainerEngineHost;
use crate::domain::types::os::OperatingSystem;
use crate::runtimes::composition::{HostPlatform, HostProfile, ResolvedApi, UnitResult};
use crate::runtimes::profiles::shared::{available_on, or_else};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PodmanNativeProfile;

#[async_trait]
impl HostProfile for PodmanNativeProfile {
    fn host(&self) -> ContainerEngineHost {
        ContainerEngineHost::PodmanNative
    }

    fn label(&self) -> &'static str {
        "Podman Native"
    }

    fn is_engine_available(&self, platform: HostPlatform) -> UnitResult<()> {
        available_on(platform, OperatingSystem::Linux, self.host())
    }

    /// `uri = readEngineSocket() || seed` — Podman keeps the `PODMAN_HOST`/`DOCKER_HOST` seed when
    /// the engine cannot be asked.
    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection {
        ApiConnection {
            uri: or_else(resolved.socket, resolved.seed),
            relay: String::new(),
            dial_stdio_command: Vec::new(),
        }
    }
}

/// Podman's own vendor virtualization — a MACHINE.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PodmanVendorProfile;

#[async_trait]
impl HostProfile for PodmanVendorProfile {
    /// The ONE host that reports its CONTROLLER's version: `podman machine` is the controller, it has
    /// a version of its own, and a client shows that rather than the engine's.
    fn adjust_capabilities(&self, base: ConnectorCapabilities) -> ConnectorCapabilities {
        ConnectorCapabilities {
            extensions: ExtensionFlags {
                controller_version: true,
                ..base.extensions
            },
            ..base
        }
    }
    fn host(&self) -> ContainerEngineHost {
        ContainerEngineHost::PodmanVirtualizedVendor
    }

    fn label(&self) -> &'static str {
        "Podman Machine"
    }

    /// `availableAlways` — a machine runs on all three desktops, which is the whole point of it.
    fn is_engine_available(&self, _platform: HostPlatform) -> UnitResult<()> {
        Ok(())
    }

    /// The machine's own address, and a relay only when that address needs bridging.
    ///
    /// A native Windows named PIPE (newer podman) is dialed directly — no relay, no bridge — so the
    /// in-VM engine socket is NOT read as a relay there. Reading it anyway is what used to overwrite a
    /// reachable pipe with a path no Windows process can open.
    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection {
        ApiConnection {
            uri: resolved.scope_uri.to_string(),
            relay: if is_named_pipe(resolved.scope_uri) {
                String::new()
            } else {
                resolved.socket.to_string()
            },
            dial_stdio_command: Vec::new(),
        }
    }
}
