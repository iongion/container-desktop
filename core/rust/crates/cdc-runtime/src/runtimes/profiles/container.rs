//! `runtimes/profiles/container.ts` — Apple's per-(engine, host) leaves.
//!
//! **Written from the original and never run**, for the same reason `dialects/container.rs` is: no
//! macOS is reachable from anywhere this port can be built.
//!
//! Only the NATIVE leaf is here. Apple's remote is
//! [`crate::runtimes::profiles::shared::SshProfile::APPLE`] — `appleSSHProfile` is
//! `sshApiConnection` + `availableAlways`, which is character for character what the other two
//! remotes are, so it is a third CONST and not a third struct.
//!
//! **What is deliberately NOT here: the macOS-version networks gate.** `appleNetworksEnabled` turns
//! `container network` off below Darwin 25 (macOS 26), and `appleRemoteDetectSettings` narrows the
//! same flag from a scoped `sw_vers` probe. Both write to the CAPABILITY table, which this port does
//! not carry at all — `machine.rs` answers `capabilities: None` and says so. Half-writing the gate
//! here would mean a capability nothing reads, which is worse than a gap that is named.

use async_trait::async_trait;

use crate::domain::types::connection::ApiConnection;
use crate::domain::types::engine::ContainerEngineHost;
use crate::domain::types::os::OperatingSystem;
use crate::runtimes::composition::{HostPlatform, HostProfile, ResolvedApi, UnitResult};
use crate::runtimes::profiles::shared::{available_on, available_on_arch};

/// What `Platform.getOsArch()` has to answer. Apple's engine is Apple-silicon only — Rosetta does
/// not virtualize, and the framework it is built on does not exist on an Intel Mac.
pub const APPLE_SILICON: &str = "arm64";

/// Apple's engine on THIS Mac, through the socket socktainer binds locally.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AppleNativeProfile;

#[async_trait]
impl HostProfile for AppleNativeProfile {
    fn host(&self) -> ContainerEngineHost {
        ContainerEngineHost::AppleNative
    }

    /// The original's, verbatim: the screen says "Container", not "Apple Container".
    fn label(&self) -> &'static str {
        "Container"
    }

    /// The only gate in the port with TWO halves, and the reason
    /// [`HostProfile::is_engine_available`] takes a whole [`HostPlatform`].
    ///
    /// The OS is asked first because it is the coarser question and because its refusal is the one
    /// a Linux or Windows user will actually see; the architecture is only interesting once the
    /// machine is already a Mac. An unreadable arch is refused rather than assumed — see
    /// [`available_on_arch`].
    fn is_engine_available(&self, platform: HostPlatform) -> UnitResult<()> {
        available_on(platform, OperatingSystem::Darwin, self.host())?;
        available_on_arch(platform, APPLE_SILICON, self.host())
    }

    /// The dialect's socket, and NO relay.
    ///
    /// A one-step ranking, which is unusual here and is the original's: `appleNativeProfile` reads
    /// `readEngineSocket` and returns it with `relay: ""`. Nothing else is consulted — not the
    /// environment seed (Apple has none, and `DOCKER_HOST` on a Mac is somebody else's daemon), not
    /// a scope (this host has none), and not a probe (the address is a convention, so there is
    /// nothing to look for).
    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection {
        ApiConnection {
            uri: resolved.socket.to_string(),
            relay: String::new(),
            dial_stdio_command: Vec::new(),
        }
    }
}
