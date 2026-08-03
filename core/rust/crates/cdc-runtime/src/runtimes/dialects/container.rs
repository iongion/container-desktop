//! `runtimes/dialects/container.ts` — Apple's `container` engine, reached through socktainer.
//!
//! **Written from the original and never run.** There is no macOS on any machine this port can
//! reach, so every rule below is pinned against `dialects/container.ts` and against nothing else;
//! the tests assert what the original does, not what a Mac was observed doing.
//!
//! `container` has no REST API of its own. socktainer serves the DOCKER surface in front of it,
//! which is why [`EngineDialect::api_surface`] answers `Docker` while the dialect is still its own:
//! the endpoint, the seed rule and the service question are all Apple's.

use async_trait::async_trait;

use crate::domain::connection::SOCKTAINER_PROGRAM;
use crate::domain::pathing::join;
use crate::domain::program::{ProgramLookup, ProgramProbe};
use crate::domain::types::connection::{
    ConnectorCapabilities, EngineConnectorSettings, ExtensionFlags, ResourceCapabilities,
};
use crate::domain::types::engine::{ApiSurface, ContainerEngine, Program};
use crate::domain::types::os::OperatingSystem;
use crate::runtimes::composition::{EngineDialect, EngineEnvironment, HostContext};
use crate::runtimes::dialects::shared::read_scoped_home;
use crate::runtimes::sort_capabilities;

/// The directory socktainer binds its socket in, under the home of whoever runs it.
pub const SOCKTAINER_SOCKET_DIRECTORY: &str = ".socktainer";

/// The socket itself.
pub const SOCKTAINER_SOCKET_NAME: &str = "container.sock";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AppleDialect;

/// `<home>/.socktainer/container.sock`.
///
/// Pure and separate from the read that finds the home, so the path rule is pinned without a host.
/// Both ends are macOS, so the separator is POSIX on either side of a remote.
pub fn socktainer_socket(home: &str) -> String {
    if home.is_empty() {
        return String::new();
    }
    let os = OperatingSystem::Darwin;
    join(
        os,
        &join(os, home, SOCKTAINER_SOCKET_DIRECTORY),
        SOCKTAINER_SOCKET_NAME,
    )
}

#[async_trait]
impl EngineDialect for AppleDialect {
    fn engine(&self) -> ContainerEngine {
        ContainerEngine::Apple
    }

    /// Apple's table: the REST surface is docker's, so the sort map is, and none of the extension
    /// groups exist. `networks` is true here and narrowed by the macOS version — see the module note.
    fn capabilities_base(&self) -> ConnectorCapabilities {
        ConnectorCapabilities {
            events: true,
            extensions: ExtensionFlags {
                builders: false,
                compose: false,
                contexts: false,
                controller_version: false,
                kube: false,
                machines: false,
                registries: false,
                registry_trust: false,
                swarm: false,
            },
            resources: ResourceCapabilities {
                networks: true,
                pods: false,
                secrets: false,
            },
            sort: sort_capabilities::docker(),
        }
    }

    /// socktainer speaks Docker's REST surface, so the adapters pick Docker's base URL and
    /// normalizers. The DIALECT is still Apple's — the two questions are genuinely separate.
    fn api_surface(&self) -> ApiSurface {
        ApiSurface::Docker
    }

    /// The socket socktainer binds, under the home of the machine the ENGINE runs on.
    ///
    /// The engine is never asked where it is listening, because it cannot answer: the address is a
    /// convention, not a report. Which HOME is the only thing that varies — the remote's for a
    /// scoped host (`printenv HOME` through the transport, `readScopedHome`) and this machine's for
    /// a native one. `scope_environment_variable` answers empty for an unscoped host WITHOUT running
    /// anything, so the fallback costs a native connection nothing.
    ///
    /// **An empty home answers an empty socket, and that is a deliberate narrowing.** The original
    /// interpolates unconditionally and would produce `/.socktainer/container.sock`, which is a path
    /// that names nothing while LOOKING resolved — enough for the availability check to call the api
    /// dimension satisfied. Every dialect here already promises "empty when it cannot be read".
    async fn read_engine_socket(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> String {
        let scoped = read_scoped_home(host, settings).await;
        let home = if scoped.is_empty() {
            host.home()
        } else {
            scoped.as_str()
        };
        socktainer_socket(home)
    }

    /// NONE — `container` has no notion of a selected endpoint. One `container` CLI talks
    /// to one apiserver, and the REST bridge in front of it is chosen by where socktainer binds.
    fn target_args(&self, _settings: &EngineConnectorSettings) -> Vec<String> {
        Vec::new()
    }

    /// **NEVER `DOCKER_HOST`**, and this is the one place the rule can be enforced.
    ///
    /// On macOS that variable commonly points at Docker Desktop or a colima daemon, and seeding an
    /// Apple connection from it would silently connect the Apple host to somebody else's engine —
    /// a connection that works, reports healthy, and manages the wrong containers. Apple's address
    /// comes from [`EngineDialect::read_engine_socket`] and from nowhere else.
    fn native_uri_seed(&self, _environment: &EngineEnvironment) -> String {
        String::new()
    }

    /// Apple manages nothing: a user runs `container system start` and socktainer themselves. `None`
    /// means "start the host manually", the same answer Docker gives, and not "not implemented".
    fn build_service_args(&self, _socket_path: &str, _log_level: &str) -> Option<Vec<String>> {
        None
    }

    /// `container.ts` has no `resolveDialStdioBridge`: what a remote forward points at is socktainer's
    /// socket, and a command invented here would be one the remote refuses.
    fn dial_stdio_program(&self) -> Option<&'static str> {
        None
    }

    /// socktainer — the only implementation of this method in the port.
    ///
    /// Found where the ENGINE lives: through the scoped cascade for a remote, on this machine for a
    /// native host. That is the same choice detection makes, and it is made the same way — from the
    /// transport's CAPABILITY, never from the host type.
    ///
    /// Always `Some`: "socktainer is not installed" is an ANSWER, and it is spelled as a `Program`
    /// with no path, exactly as every other lookup here spells it.
    async fn describe_api_bridge(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> Option<Program> {
        let lookup = ProgramLookup::for_target(host.os_type(), host.is_scoped());
        let probe = if host.is_scoped() {
            ProgramProbe::find_scope_program(SOCKTAINER_PROGRAM, lookup)
        } else {
            ProgramProbe::find_host_program(SOCKTAINER_PROGRAM, lookup)
        };
        Some(probe.run(host, settings).await)
    }
}
