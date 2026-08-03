//! The connector table — `runtimes/registry.ts`.
//!
//! Twelve connectors: Podman × 5, Docker × 5, Apple × 2. Each names its engine, its host, and the two
//! binaries no single unit carries — the ENGINE program and the CONTROLLER that enters the scope. The
//! three units are then chosen from the host, which is what `createComposedHostClient` does.
//!
//! It is a table rather than a `match` because that is what the original is, and because the identity
//! and the units are different questions: `podman.virtualized.wsl` is a connector whose controller is
//! `wsl` whether or not a WSL transport exists yet.
//!
//! **`compose` has no wildcard arm, deliberately.** All twelve compose now, and the arms stay
//! written out one per host so that adding a host type to [`ContainerEngineHost`] does not compile
//! until it is handled here. A `_ =>` would let the next one be silently treated as native, which
//! would point a remote host at the local engine.

use crate::domain::connection::{
    APPLE_PROGRAM, DOCKER_PROGRAM, LIMA_PROGRAM, PODMAN_PROGRAM, SSH_PROGRAM, WSL_PROGRAM,
};
use crate::domain::types::connection::ConnectorCapabilities;
use crate::domain::types::engine::{ApiSurface, ContainerEngine, ContainerEngineHost};
use crate::runtimes::composition::{EngineDialect, HostProfile, Transport};
use crate::runtimes::dialects::container::AppleDialect;
use crate::runtimes::dialects::docker::DockerDialect;
use crate::runtimes::dialects::podman::PodmanDialect;
use crate::runtimes::profiles::container::AppleNativeProfile;
use crate::runtimes::profiles::docker::{DockerNativeProfile, DockerVendorProfile};
use crate::runtimes::profiles::podman::{PodmanNativeProfile, PodmanVendorProfile};
use crate::runtimes::profiles::shared::{LimaProfile, SshProfile, WslProfile};
use crate::runtimes::transports::lima::LimaTransport;
use crate::runtimes::transports::native::NativeTransport;
use crate::runtimes::transports::podman_machine::PodmanMachineTransport;
use crate::runtimes::transports::ssh::SshTransport;
use crate::runtimes::transports::wsl::WslTransport;

/// One registered connector: its identity and its binaries.
///
/// The units are NOT fields. In the original they are — `createTransport` is a factory there because
/// SSH, WSL and podman-machine keep per-connection state — and here [`compose`] builds a fresh set per
/// call for the same reason, so a table of shared trait objects would be the wrong shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Connector {
    pub engine: ContainerEngine,
    pub host: ContainerEngineHost,
    /// The engine binary.
    pub program: &'static str,
    /// What enters the scope: `wsl`, `limactl`, `ssh`, or `podman` for a machine. A native host has no
    /// scope, and the original still fills this in with the engine binary rather than leaving it
    /// empty — the field is unused there, and an empty string would read as "not configured".
    pub controller: &'static str,
}

/// Every connector the app offers, in the original's order.
pub const CONNECTORS: [Connector; 12] = [
    Connector {
        engine: ContainerEngine::Podman,
        host: ContainerEngineHost::PodmanNative,
        program: PODMAN_PROGRAM,
        controller: PODMAN_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Podman,
        host: ContainerEngineHost::PodmanVirtualizedVendor,
        program: PODMAN_PROGRAM,
        controller: PODMAN_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Podman,
        host: ContainerEngineHost::PodmanVirtualizedWsl,
        program: PODMAN_PROGRAM,
        controller: WSL_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Podman,
        host: ContainerEngineHost::PodmanVirtualizedLima,
        program: PODMAN_PROGRAM,
        controller: LIMA_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Podman,
        host: ContainerEngineHost::PodmanRemote,
        program: PODMAN_PROGRAM,
        controller: SSH_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Docker,
        host: ContainerEngineHost::DockerNative,
        program: DOCKER_PROGRAM,
        controller: DOCKER_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Docker,
        host: ContainerEngineHost::DockerVirtualizedVendor,
        program: DOCKER_PROGRAM,
        controller: DOCKER_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Docker,
        host: ContainerEngineHost::DockerVirtualizedWsl,
        program: DOCKER_PROGRAM,
        controller: WSL_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Docker,
        host: ContainerEngineHost::DockerVirtualizedLima,
        program: DOCKER_PROGRAM,
        controller: LIMA_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Docker,
        host: ContainerEngineHost::DockerRemote,
        program: DOCKER_PROGRAM,
        controller: SSH_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Apple,
        host: ContainerEngineHost::AppleNative,
        program: APPLE_PROGRAM,
        controller: APPLE_PROGRAM,
    },
    Connector {
        engine: ContainerEngine::Apple,
        host: ContainerEngineHost::AppleRemote,
        program: APPLE_PROGRAM,
        controller: SSH_PROGRAM,
    },
];

/// The connector for an (engine, host) pair — `resolveHostClientRegistryEntry`.
///
/// `Option` where the original throws: a caller reading a settings file can be handed a pair no
/// release ever registered, and that is a diagnostic rather than a panic.
pub fn resolve(engine: ContainerEngine, host: ContainerEngineHost) -> Option<&'static Connector> {
    CONNECTORS
        .iter()
        .find(|it| it.engine == engine && it.host == host)
}

/// What one connection is composed from: the three units, plus the two binaries no single unit
/// carries.
///
/// `program` and `controller` travel with the units because the client needs all five together and
/// looking the connector up twice is how the two lookups start to disagree.
pub struct ComposedUnits {
    pub dialect: Box<dyn EngineDialect>,
    pub profile: Box<dyn HostProfile>,
    pub transport: Box<dyn Transport>,
    /// The engine binary.
    pub program: &'static str,
    /// What enters the scope.
    pub controller: &'static str,
}

/// Why a pair could not be composed.
///
/// One variant, and it used to be two: `Unimplemented` named a REGISTERED connector whose units this
/// port had not written, and it became unconstructible the moment the two Apple arms landed. It was
/// deleted rather than left as an arm nothing can reach — an unreachable failure is a failure mode
/// readers will reason about and tests will keep pretending to cover.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComposeError {
    /// No connector pairs this engine with this host — a `podman` engine on a `docker.native` host is
    /// not a missing feature, it is not a thing. Reachable from a settings file naming a pair no
    /// release ever registered, which is why it is a diagnostic and not a panic.
    NotAConnector {
        engine: ContainerEngine,
        host: ContainerEngineHost,
    },
}

/// What a connector can do — `HostClient`'s
/// `profile.adjustCapabilities(dialect.capabilitiesBase)`, and nothing else.
///
/// A free function rather than only a field on the composed client, because the two callers need it
/// at different moments: a RUNNING connection projects it from its machine, and a connection merely
/// listed in the settings document has no client and is still asked what it can do. It is a pure
/// function of the pair, so both answers agree by construction.
pub fn capabilities(
    engine: ContainerEngine,
    host: ContainerEngineHost,
) -> Result<ConnectorCapabilities, ComposeError> {
    let units = compose(engine, host)?;
    Ok(units
        .profile
        .adjust_capabilities(units.dialect.capabilities_base()))
}

/// Which REST vocabulary a connector speaks — `dialect.apiSurface`.
///
/// Beside [`capabilities`] and for the same reason: a connection that is merely LISTED has no composed
/// client and a client still has to know which root its adapters address.
pub fn api_surface(
    engine: ContainerEngine,
    host: ContainerEngineHost,
) -> Result<ApiSurface, ComposeError> {
    Ok(compose(engine, host)?.dialect.api_surface())
}

/// The units for a connector, or the reason there are none.
pub fn compose(
    engine: ContainerEngine,
    host: ContainerEngineHost,
) -> Result<ComposedUnits, ComposeError> {
    let connector = resolve(engine, host).ok_or(ComposeError::NotAConnector { engine, host })?;
    match connector.host {
        ContainerEngineHost::PodmanNative => Ok(ComposedUnits {
            dialect: Box::new(PodmanDialect),
            profile: Box::new(PodmanNativeProfile),
            transport: Box::new(NativeTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        ContainerEngineHost::DockerNative => Ok(ComposedUnits {
            dialect: Box::new(DockerDialect),
            profile: Box::new(DockerNativeProfile),
            transport: Box::new(NativeTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        ContainerEngineHost::PodmanRemote => Ok(ComposedUnits {
            dialect: Box::new(PodmanDialect),
            profile: Box::new(SshProfile::PODMAN),
            transport: Box::new(SshTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        ContainerEngineHost::DockerRemote => Ok(ComposedUnits {
            dialect: Box::new(DockerDialect),
            profile: Box::new(SshProfile::DOCKER),
            transport: Box::new(SshTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        // The engine runs inside a distribution, and both engines enter it the same way — the profile
        // is shared for the same reason the two remotes share theirs.
        ContainerEngineHost::PodmanVirtualizedWsl => Ok(ComposedUnits {
            dialect: Box::new(PodmanDialect),
            profile: Box::new(WslProfile::PODMAN),
            transport: Box::new(WslTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        ContainerEngineHost::DockerVirtualizedWsl => Ok(ComposedUnits {
            dialect: Box::new(DockerDialect),
            profile: Box::new(WslProfile::DOCKER),
            transport: Box::new(WslTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        // A LIMA instance is entered the same way by both engines, and neither is asked where it
        // listens — the socket is the INSTANCE's.
        ContainerEngineHost::PodmanVirtualizedLima => Ok(ComposedUnits {
            dialect: Box::new(PodmanDialect),
            profile: Box::new(LimaProfile::PODMAN),
            transport: Box::new(LimaTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        ContainerEngineHost::DockerVirtualizedLima => Ok(ComposedUnits {
            dialect: Box::new(DockerDialect),
            profile: Box::new(LimaProfile::DOCKER),
            transport: Box::new(LimaTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        // Podman's vendor host is a MACHINE, and the transport is Podman's alone.
        ContainerEngineHost::PodmanVirtualizedVendor => Ok(ComposedUnits {
            dialect: Box::new(PodmanDialect),
            profile: Box::new(PodmanVendorProfile),
            transport: Box::new(PodmanMachineTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        // Docker's vendor host is UNSCOPED and uses the NATIVE transport, where Podman's vendor host
        // enters a machine. Reading them as siblings is the mistake this arm exists to prevent.
        ContainerEngineHost::DockerVirtualizedVendor => Ok(ComposedUnits {
            dialect: Box::new(DockerDialect),
            profile: Box::new(DockerVendorProfile),
            transport: Box::new(NativeTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        // Apple speaks the Docker REST surface through socktainer, but its dialect is its own: the
        // socket is `$HOME/.socktainer/container.sock` and never `DOCKER_HOST`, which on macOS
        // commonly points at a non-Apple daemon. Native is UNSCOPED — socktainer binds on this Mac —
        // so it takes the native transport, exactly as Docker Desktop does.
        ContainerEngineHost::AppleNative => Ok(ComposedUnits {
            dialect: Box::new(AppleDialect),
            profile: Box::new(AppleNativeProfile),
            transport: Box::new(NativeTransport),
            program: connector.program,
            controller: connector.controller,
        }),
        // The remote is an SSH host like the other two, and the engine at the far end is the only
        // thing that differs — which is the dialect's business and not the profile's.
        ContainerEngineHost::AppleRemote => Ok(ComposedUnits {
            dialect: Box::new(AppleDialect),
            profile: Box::new(SshProfile::APPLE),
            transport: Box::new(SshTransport),
            program: connector.program,
            controller: connector.controller,
        }),
    }
}
