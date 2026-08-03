//! `runtimes/profiles/shared.ts` — what the thin per-(engine, host) profiles share.
//!
//! The OS gates and the two profiles whose bodies are IDENTICAL across engines live here; each
//! engine's own leaves live in `profiles/{podman,docker,container}.rs`, as the original arranges them.
//!
//! **A shared profile carries its host as DATA rather than being copied per engine.** The original's
//! `podmanSSHProfile` and `dockerSSHProfile` differ only in which host they name and which label they
//! carry, and a second copy is where the two would start to disagree.
//!
//! Every `api_connection` here is PURE, and deliberately so: the two ends of a connection are a
//! RANKING, and a ranking that could also perform I/O would be free to consult a second source and
//! disagree with itself. What it ranks is supplied by the transport (the imposed scope URI) and the
//! dialect (the engine's own answer), both already resolved by the caller.

use async_trait::async_trait;

use crate::domain::diagnostic::Diagnostic;
use crate::domain::types::connection::{ApiConnection, ConnectorCapabilities, ExtensionFlags};
use crate::domain::types::diagnostic::DiagnosticCode;
use crate::domain::types::engine::ContainerEngineHost;
use crate::domain::types::os::OperatingSystem;
use crate::runtimes::composition::{HostPlatform, HostProfile, ResolvedApi, UnitResult};

/// `availableOn` — this engine runs on exactly one operating system.
pub fn available_on(
    platform: HostPlatform,
    required: OperatingSystem,
    host: ContainerEngineHost,
) -> UnitResult<()> {
    if platform.os == required {
        return Ok(());
    }
    Err(not_available(platform.os, host))
}

/// `availableUnless` — this engine runs everywhere EXCEPT one operating system.
///
/// Docker Desktop's, and not the same rule as [`available_on`]'s negation: it is available on macOS
/// and Windows and refused on Linux, where the native host is what a user wants.
pub fn available_unless(
    platform: HostPlatform,
    refused: OperatingSystem,
    host: ContainerEngineHost,
) -> UnitResult<()> {
    if platform.os == refused {
        return Err(not_available(platform.os, host));
    }
    Ok(())
}

/// The second half of a gate, for the one engine that has one — Apple silicon.
///
/// A separate refusal CODE rather than more parameters on the OS one: `ENGINE_NOT_AVAILABLE_ON_OS`
/// would be a lie about a Mac that is simply an Intel Mac, and a client that renders "not available
/// on Darwin" there sends someone to the wrong answer.
///
/// **An EMPTY arch is refused, not waved through.** The original wraps `Platform.getOsArch()` in a
/// `try` and answers `{ success: false, details: "…unable to detect architecture" }` from the
/// `catch`, so an unreadable architecture already fails the gate there.
pub fn available_on_arch(
    platform: HostPlatform,
    required: &str,
    host: ContainerEngineHost,
) -> UnitResult<()> {
    if platform.arch == required {
        return Ok(());
    }
    Err(Diagnostic::with_params(
        DiagnosticCode::EngineNotAvailableOnArch,
        serde_json::json!({
            "host": host.to_string(),
            "arch": platform.arch,
            "required": required,
        }),
    ))
}

/// The OS gate's refusal. The client renders the prose, so the parameters carry both facts.
fn not_available(os: OperatingSystem, host: ContainerEngineHost) -> Diagnostic {
    Diagnostic::with_params(
        DiagnosticCode::EngineNotAvailableOnOs,
        serde_json::json!({ "host": host.to_string(), "osType": os.to_string() }),
    )
}

/// `a || b` on strings, which is what the oracle's fallback chains are.
pub fn or_else<'a>(value: &'a str, fallback: &'a str) -> String {
    if value.is_empty() {
        return fallback.to_string();
    }
    value.to_string()
}

/// The profile both remote engines share (`profiles/shared.ts:sshApiConnection`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SshProfile {
    host: ContainerEngineHost,
    label: &'static str,
}

impl SshProfile {
    pub const PODMAN: Self = Self {
        host: ContainerEngineHost::PodmanRemote,
        label: "Podman SSH",
    };
    pub const DOCKER: Self = Self {
        host: ContainerEngineHost::DockerRemote,
        label: "Docker SSH",
    };
    /// Apple's remote. A third CONST rather than a third struct: `appleSSHProfile` is
    /// `sshApiConnection` + `availableAlways`, character for character what the other two are, and
    /// the only thing Apple changes about a remote is the engine at the far end of the tunnel.
    pub const APPLE: Self = Self {
        host: ContainerEngineHost::AppleRemote,
        label: "Container SSH",
    };
}

#[async_trait]
impl HostProfile for SshProfile {
    /// A scoped or remote host manages no MACHINES: the machine is the guest this connection is
    /// already inside, so `podman machine` there would address the wrong thing.
    ///
    /// Applied unconditionally rather than per engine, and that is not a shortcut — docker's and
    /// Apple's bases already answer `false`, so narrowing costs them nothing and this profile never
    /// has to ask which engine it is carrying.
    fn adjust_capabilities(&self, base: ConnectorCapabilities) -> ConnectorCapabilities {
        ConnectorCapabilities {
            extensions: ExtensionFlags {
                machines: false,
                ..base.extensions
            },
            ..base
        }
    }
    fn host(&self) -> ContainerEngineHost {
        self.host
    }

    fn label(&self) -> &'static str {
        self.label
    }

    /// `availableAlways` — the gate asks where the CLIENT runs, and `ssh` runs everywhere. Whether
    /// the REMOTE can run the engine is the remote's business, and the detection probe is what finds
    /// that out.
    fn is_engine_available(&self, _platform: HostPlatform) -> UnitResult<()> {
        Ok(())
    }

    /// The two ends of the tunnel, and they are not interchangeable: `uri` is where a client on THIS
    /// machine connects, `relay` is what the forward points at on the remote. Each falls back to what
    /// the user configured, because a remote whose engine cannot be asked may still have been set up
    /// by hand.
    ///
    /// The local end is a THREE-step chain, and the order is the whole behaviour: an address the scope
    /// imposes (a Windows relay pipe) wins, then whatever was preset — which is what
    /// `ensureRemoteForwardAddress` leaves on POSIX, and what detection must not overwrite
    /// — and only with neither is one derived. Collapsing it to two steps breaks one OS or the other.
    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection {
        ApiConnection {
            uri: or_else(
                resolved.scope_uri,
                &or_else(&resolved.configured.uri, resolved.local_fallback),
            ),
            relay: or_else(resolved.socket, &resolved.configured.relay),
            // Data plane B, passed straight through as `getApiConnection` passes `bridge.command`.
            // **This is what makes a remote podman MACHINE reachable**: its socket is inside a VM, so
            // the `relay` above names an address on the far side of a hop the forward cannot take, and
            // `SshTransport::resolve_dial_stdio` composes the two hops that can.
            dial_stdio_command: resolved.dial_stdio.to_vec(),
        }
    }
}

/// The profile both LIMA engines share (`profiles/shared.ts:limaApiConnection`).
///
/// Identical across engines in the original too, and for a stronger reason than the WSL pair's: the
/// instance's socket is LIMA's, so neither engine is asked anything at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LimaProfile {
    host: ContainerEngineHost,
    label: &'static str,
}

impl LimaProfile {
    pub const PODMAN: Self = Self {
        host: ContainerEngineHost::PodmanVirtualizedLima,
        label: "Podman LIMA",
    };
    pub const DOCKER: Self = Self {
        host: ContainerEngineHost::DockerVirtualizedLima,
        label: "Docker LIMA",
    };
}

#[async_trait]
impl HostProfile for LimaProfile {
    /// A scoped or remote host manages no MACHINES: the machine is the guest this connection is
    /// already inside, so `podman machine` there would address the wrong thing.
    ///
    /// Applied unconditionally rather than per engine, and that is not a shortcut — docker's and
    /// Apple's bases already answer `false`, so narrowing costs them nothing and this profile never
    /// has to ask which engine it is carrying.
    fn adjust_capabilities(&self, base: ConnectorCapabilities) -> ConnectorCapabilities {
        ConnectorCapabilities {
            extensions: ExtensionFlags {
                machines: false,
                ..base.extensions
            },
            ..base
        }
    }
    fn host(&self) -> ContainerEngineHost {
        self.host
    }

    fn label(&self) -> &'static str {
        self.label
    }

    fn is_engine_available(&self, platform: HostPlatform) -> UnitResult<()> {
        available_on(platform, OperatingSystem::Darwin, self.host())
    }

    /// NO — LIMA is one of the two hosts the oracle's flatpak list leaves out.
    ///
    /// The forwarded socket it binds is under the user's own home (`~/.lima/<instance>/sock/…`), which
    /// a sandboxed process reaches at the path it already has. Prefixing it would compose an address
    /// in a namespace nothing binds.
    fn sandbox_maps_socket(&self) -> bool {
        false
    }

    /// The instance's own socket, and NO relay.
    ///
    /// LIMA binds the forwarded socket on THIS machine, so there is nothing to relay to. Which socket
    /// it is, is [`crate::runtimes::transports::lima::forwarded_socket`]'s answer, not this leaf's.
    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection {
        ApiConnection {
            uri: resolved.scope_uri.to_string(),
            relay: String::new(),
            dial_stdio_command: Vec::new(),
        }
    }
}

/// The profile both WSL engines share (`profiles/{podman,docker}.ts`'s WSL leaves).
///
/// One struct for the same reason [`SshProfile`] is one: the original's two differ in the host they
/// name and in nothing else. Their `getApiConnection` bodies both rank the imposed pipe against the
/// engine's own socket, and their gates are both Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WslProfile {
    host: ContainerEngineHost,
    label: &'static str,
}

impl WslProfile {
    pub const PODMAN: Self = Self {
        host: ContainerEngineHost::PodmanVirtualizedWsl,
        label: "Podman WSL",
    };
    pub const DOCKER: Self = Self {
        host: ContainerEngineHost::DockerVirtualizedWsl,
        label: "Docker WSL",
    };
}

#[async_trait]
impl HostProfile for WslProfile {
    /// A scoped or remote host manages no MACHINES: the machine is the guest this connection is
    /// already inside, so `podman machine` there would address the wrong thing.
    ///
    /// Applied unconditionally rather than per engine, and that is not a shortcut — docker's and
    /// Apple's bases already answer `false`, so narrowing costs them nothing and this profile never
    /// has to ask which engine it is carrying.
    fn adjust_capabilities(&self, base: ConnectorCapabilities) -> ConnectorCapabilities {
        ConnectorCapabilities {
            extensions: ExtensionFlags {
                machines: false,
                ..base.extensions
            },
            ..base
        }
    }
    fn host(&self) -> ContainerEngineHost {
        self.host
    }

    fn label(&self) -> &'static str {
        self.label
    }

    fn is_engine_available(&self, platform: HostPlatform) -> UnitResult<()> {
        available_on(platform, OperatingSystem::WindowsNt, self.host())
    }

    /// NO — the other host the oracle's flatpak list leaves out, and here it is doubly moot: flatpak
    /// is Linux-only and this leaf is gated to Windows, so the two can never both be true.
    fn sandbox_maps_socket(&self) -> bool {
        false
    }

    /// The local pipe the app's relay serves, against the socket the engine binds INSIDE the guest.
    ///
    /// Neither end falls back to the other: a Windows pipe is not a path the guest can bind and the
    /// guest's socket is not an address a Windows client can dial, so a chain across them would
    /// produce a connection that looks complete and reaches nothing.
    ///
    /// **The original's "getApiConnection requires a scope" guard is one step EARLIER here, and it is
    /// not lost.** A WSL connection with no scope never reaches detection: the machine refuses a named
    /// scope the host does not offer (`SCOPE_NOT_FOUND`) and the transport refuses an absent one
    /// (`SCOPE_NOT_SET`), both in sub-step 1, before the engine is asked anything.
    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection {
        ApiConnection {
            uri: resolved.scope_uri.to_string(),
            relay: resolved.socket.to_string(),
            // Passed straight through, exactly as `getApiConnection` passes `bridge.command` through:
            // composing it is the TRANSPORT's job, because entering a distribution is what it knows.
            // **This is what makes a WSL connection reachable.** The `uri` above is a pipe the app's
            // relay would serve, and this port has no relay — so without the bridge the address resolves
            // and nothing on the machine can dial it.
            dial_stdio_command: resolved.dial_stdio.to_vec(),
        }
    }
}
