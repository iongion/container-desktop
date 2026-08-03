//! The binaries a connection is made of — `connection.ts`.
//!
//! Names, not paths: what is on disk is detection's answer (`detector.rs`), and a constant that
//! carried a path would be a second, stale source for it.

/// The engine binaries.
pub const PODMAN_PROGRAM: &str = "podman";
pub const DOCKER_PROGRAM: &str = "docker";

/// Apple's engine. The binary is `container` — Apple's own name for the tool — which is also the wire
/// value of [`crate::domain::types::engine::ContainerEngine::Apple`].
pub const APPLE_PROGRAM: &str = "container";

/// The Docker-API bridge Apple's engine is reached through. Not an engine: `container` has no REST
/// API of its own, so socktainer serves the Docker surface in front of it, and its presence is a
/// thing the availability report has to be able to say something about.
pub const SOCKTAINER_PROGRAM: &str = "socktainer";

/// The controller binaries — what enters a scope, rather than what runs containers.
pub const WSL_PROGRAM: &str = "wsl";
pub const LIMA_PROGRAM: &str = "limactl";
pub const SSH_PROGRAM: &str = "ssh";
