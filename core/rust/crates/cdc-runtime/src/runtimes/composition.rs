//! The 3-unit composition seam — `runtimes/composition.ts`.
//!
//! `Transport` (scope mechanics, per host type) × `EngineDialect` (engine commands, per engine) ×
//! `HostProfile` (the thin per-(engine, host) glue). The [`HostClient`](crate::runtimes::host_client)
//! composes exactly one of each and IS the [`HostContext`] their methods receive — which is what the
//! original's `getContextInspect(client, …)` helpers do, and why the context is a trait rather than a
//! struct: the units must not know what owns them.
//!
//! **The units perform their own I/O**, through the [`capabilities`](crate::capabilities) traits the
//! context exposes. There is no plan, no step and no executor: those were an invention with no
//! counterpart here, and they are gone.
//!
//! What this surface deliberately does NOT carry, each with the reason rather than a silence:
//!
//! - **The 23 engine-extension methods** (machines, kube, contexts, swarm, builders, compose) are
//!   resource CRUD, which stays in `container-client`. `bindExtensions` arrives with them.
//! - **`getApiDriver`** is the `Http` capability's, not exec's — the original returns an
//!   `AxiosInstance` and the port answers that with `capabilities::http`, which the availability check
//!   now asks: "the API is up" means the engine ANSWERED, not that an address was resolved.
//! - **`runScopeCommandStreaming`** has no consumer here: streaming is the build and log-follow
//!   surface, which is resource CRUD.

use async_trait::async_trait;

use crate::capabilities::command::{Command, CommandExecutionResult, HostCommand};
use crate::capabilities::fs::Fs;
use crate::capabilities::http::Http;
use crate::domain::diagnostic::Diagnostic;
use crate::domain::types::connection::{
    ApiConnection, ConnectorCapabilities, EngineConnectorSettings,
};
use crate::domain::types::engine::{
    ApiSurface, ContainerEngine, ContainerEngineHost, EngineContext, Program,
};
use crate::domain::types::host::StartupStatus;
use crate::domain::types::machine::ControllerScope;
use crate::domain::types::os::OperatingSystem;
use crate::runtimes::transports::shared::program_launcher;

/// A failure a unit reached, as a code rather than prose.
///
/// The original throws an `Error` carrying an English sentence; a core whose clients render their own
/// prose cannot, so every refusal here is a [`Diagnostic`]. This is the one sanctioned divergence and
/// it is recorded, not assumed.
pub type UnitResult<T> = Result<T, Diagnostic>;

/// The composed surface a unit method receives — the `HostClient` itself.
///
/// `Send + Sync` because a connection is driven from a spawned task and the client sits in an `Arc`
/// behind it.
#[async_trait]
pub trait HostContext: Send + Sync {
    /// The connection id. It qualifies every service this host spawns, so a torn-down attempt kills
    /// its OWN forward and not another connection's.
    fn id(&self) -> &str;

    /// Where the CLIENT runs — never the remote's OS, which detection probes for separately.
    fn os_type(&self) -> OperatingSystem;

    /// `Platform.getOsArch()` — node's `process.arch` for the machine the CLIENT runs on.
    ///
    /// Host knowledge, so it arrives as data for the same reason [`HostContext::home`] does. EMPTY
    /// when it could not be read, which the original reaches through a `catch` and refuses on.
    fn arch(&self) -> &str;

    /// `Platform.isFlatpak()` — whether this process reaches the host's filesystem through a prefix.
    ///
    /// **Required, not defaulted**, like [`HostContext::arch`] and [`HostContext::home`] beside it.
    /// A default of `false` looked harmless and was dead code: `HostClient` is this trait's only
    /// implementor and answers from its environment, so nothing could ever execute it — and the next
    /// implementor would inherit "not sandboxed" silently rather than being asked. See
    /// [`crate::domain::sandbox`] for the rule it selects and for why this is data, not a capability.
    fn is_flatpak(&self) -> bool;

    /// The machine an OS gate asks about, as one value.
    ///
    /// Defaulted rather than stored: it is a VIEW of two accessors the context already has, and a
    /// field would be a second source able to disagree with them.
    fn platform(&self) -> HostPlatform<'_> {
        HostPlatform {
            os: self.os_type(),
            arch: self.arch(),
        }
    }

    fn transport(&self) -> &dyn Transport;
    fn dialect(&self) -> &dyn EngineDialect;
    fn profile(&self) -> &dyn HostProfile;

    /// The engine binary this connector was registered with (`PROGRAM`), used when the settings carry
    /// no resolved path yet.
    fn program(&self) -> &str;

    /// What enters the scope (`CONTROLLER`): `wsl`, `limactl`, `ssh`, or `podman` for a machine.
    fn controller(&self) -> &str;

    /// The scope this connection resolved, as a VALUE.
    ///
    /// The original passes a scope NAME to every transport method. That could not be ported: `ssh`
    /// needs the host, the port, the user and the identity, and a name is a key into a table
    /// (`~/.ssh/config`) the runtime cannot read for itself. Resolving it is the caller's, so the
    /// resolved scope arrives here and the transport reads it — one place, not two.
    ///
    /// It is the VALUE of the name in `settings.controller.scope`; the two are resolved together by
    /// the caller and must not be resolved again here, or a transport could act on a scope the
    /// settings do not name.
    fn scope(&self) -> Option<&ControllerScope>;

    /// Where `~` and a relative `IdentityFile` resolve. Host knowledge, so it arrives as data for the
    /// same reason the clock does.
    fn home(&self) -> &str;

    /// `Platform.getUserDataPath()` — where a POSIX forward socket is bound.
    fn user_data_path(&self) -> &str;

    /// What the engine's own service is asked to log at (`opts?.logLevel || "warn"`).
    fn log_level(&self) -> &str;

    /// The APP's version, for the `User-Agent` a request to this connection's engine carries.
    /// Host knowledge, like `log_level` and `home` beside it — never read here.
    fn app_version(&self) -> &str;

    /// What a process this connection starts on THIS machine is told about reaching the internet —
    /// `getEngineProxyEnv()`, resolved for this connection (`domain::proxy`).
    ///
    /// **Empty for a scoped connection, and that asymmetry is the behaviour** (`host-client.ts:284`):
    /// the variables describe how to leave this machine, so a command running inside a WSL
    /// distribution or on the far side of an `ssh` would be configured for the wrong network.
    /// Answered here rather than carried on a [`HostCommand`] flag, because only this knows both
    /// halves — whether the connection is scoped, and what its effective proxy is.
    fn engine_proxy_env(&self) -> Vec<(String, String)>;

    /// The exec capability, for the transport that spawns a long-lived service through it.
    ///
    /// Separate from [`HostContext::run_host_command`] because a SERVICE is not a command: it
    /// outlives the call that starts it, is polled for readiness, and is killed by name. Only a
    /// transport needs it.
    fn command(&self) -> &dyn Command;

    /// The filesystem, for the units that must ask whether a socket or a program is there.
    fn fs(&self) -> &dyn Fs;

    /// The engine's own API — `getApiDriver`, which is this capability and not exec's.
    ///
    /// Only the availability check needs it: everything else here talks to the engine through
    /// its CLI. A socket that exists proves an address was resolved, and only this answers whether
    /// anything is serving on it.
    fn http(&self) -> &dyn Http;

    async fn settings(&self) -> EngineConnectorSettings;

    async fn set_settings(&self, settings: EngineConnectorSettings);

    /// `host-client.ts:runHostCommand` — run on THIS machine.
    ///
    /// Two behaviours travel with it and are the reason it is not just `Command::run`: Windows gets
    /// `.exe` appended when the launcher lacks it, and the host-side proxy environment is passed only
    /// when the connection is UNSCOPED.
    ///
    /// Infallible by design. `Command.Execute` in the original catches and returns
    /// `{ success: false }`, so "the binary is not there" is an exit code a unit parses rather than an
    /// error that bypasses it — see the note on the implementation.
    async fn run_host_command(&self, command: &HostCommand) -> CommandExecutionResult;

    /// `host-client.ts:runScopeCommand` — run INSIDE the scope, via the transport's wrapper.
    async fn run_scope_command(
        &self,
        program: &str,
        args: &[String],
        settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult>;

    /// `base.ts:getScopeEnvironmentVariable` — a scoped `printenv` read.
    ///
    /// Empty when it cannot be read, exactly as the original leaves it: the callers
    /// (`getConnectionDataDir`, the Docker-WSL relay, Apple's remote `HOME`) all treat absence as a
    /// fallback rather than a failure.
    async fn scope_environment_variable(
        &self,
        variable: &str,
        settings: &EngineConnectorSettings,
    ) -> String;

    fn is_scoped(&self) -> bool {
        self.transport().is_scoped()
    }

    /// Run one command wherever this connection's ENGINE lives — in the scope, or on this machine.
    ///
    /// The single branch on `is_scoped`. `pruneSystem`, `resetSystem` and `isProgramAvailable` each
    /// spell it out in the original, and every dialect and probe needs it too; three copies is where
    /// they start to disagree about which one a scoped host gets.
    async fn run_probe(
        &self,
        command: &HostCommand,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult> {
        if self.is_scoped() {
            return self
                .run_scope_command(&command.launcher, &command.args, settings)
                .await;
        }
        Ok(self.run_host_command(command).await)
    }

    /// Run the ENGINE's own CLI, wherever this connection's engine lives.
    ///
    /// The program comes from `settings`, not the context: during detection it is a candidate, and
    /// `settings.program.path || settings.program.name` is the original's fallback — an undetected
    /// program is still probed BY NAME, because it may be on the PATH of whatever runs the command.
    ///
    /// **The dialect's target flags go in FRONT of the caller's args, and this is the only place
    /// they are applied**. A connection pinned to a Docker context is pinned for every
    /// command it runs, present and future, because the pin is part of composing the engine's argv
    /// rather than something each call site remembers — two call sites that each remembered would
    /// eventually disagree about which engine this connection means.
    async fn run_engine_command(
        &self,
        args: &[String],
        settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult> {
        let mut command = HostCommand::new(program_launcher(settings), &[]);
        command.args = self.dialect().target_args(settings);
        command.args.extend_from_slice(args);
        self.run_probe(&command, settings).await
    }
}

/// Scope mechanics for a host TYPE, engine-agnostic — one per Native / SSH / WSL / LIMA /
/// PodmanMachine.
///
/// Every transport implements the whole surface; an unscoped one answers with an absence rather than
/// being asked a different question. That is `facade.ts`'s "maximize symmetry, even with no-ops", and
/// it is what lets callers branch on capability instead of on host identity.
///
/// **`settings` is a parameter on every method that reads one, and never taken from the context.**
/// The original's `settings?: EngineConnectorSettings` is not an optional convenience: detection asks
/// the engine about a CANDIDATE program path before that path is the connection's, so a unit that read
/// `host.settings()` would answer about the previous binary and detection would converge on a lie.
#[async_trait]
pub trait Transport: Send + Sync {
    fn is_scoped(&self) -> bool;

    /// Whether a scope this app started should be left running when the connection goes away.
    fn should_keep_started_scope_running(&self) -> bool {
        true
    }

    /// Wrap `program`/`args` so they execute inside the scope, and run them.
    ///
    /// `NativeTransport` refuses: "Scope is not supported in native mode" is a throw in the original,
    /// and a native host has no scope to name.
    async fn run_scope_command(
        &self,
        host: &dyn HostContext,
        program: &str,
        args: &[String],
        settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult>;

    /// Translate a LOCAL path to its guest-side spelling. Identity everywhere except WSL, which maps
    /// a drive letter to `/mnt/<letter>`.
    async fn resolve_guest_path(&self, host: &dyn HostContext, local_path: &str) -> String;

    /// The scopes this host can offer — `getControllerScopes`.
    async fn list_scopes(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<Vec<ControllerScope>>;

    /// The scope to use when the settings name none.
    async fn controller_default_scope(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<Option<ControllerScope>>;

    /// Make the scope usable. An unscoped transport has nothing to start and says so.
    async fn start_scope(&self, host: &dyn HostContext) -> UnitResult<StartupStatus>;

    async fn stop_scope(&self, host: &dyn HostContext) -> UnitResult<bool>;

    /// The local address the scope IMPOSES — `transports/ssh.ts:resolveScopeURI`.
    ///
    /// Authoritative: where a transport dictates the address (a Windows relay pipe) nothing else is
    /// reachable, so it outranks the settings. Empty means "no opinion", which is every POSIX scope
    /// and every unscoped host — an absence, not an error.
    ///
    /// `socket` is what [`EngineDialect::read_engine_socket`] just reported. Only LIMA reads it, to
    /// tell its engine's forward from the other's; it is passed rather than read off the settings
    /// because those still hold the previous run's value at detection time.
    async fn resolve_scope_uri(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
        socket: &str,
    ) -> String;

    /// The command that reaches this connection's engine over stdio — `resolveDialStdioBridge`.
    ///
    /// **Data plane B, and for some connections it is the only one there is.** An engine inside a WSL
    /// distribution or a VM binds a socket this machine cannot open, and no `ssh -NL` makes that false.
    /// What is left is to ask the engine to bridge its own socket to a pipe pair and speak HTTP down it
    /// — `docker system dial-stdio`, which Docker ships for exactly this reason.
    ///
    /// On the TRANSPORT rather than the dialect, which is where the original puts it, and the reason is
    /// the argv: entering a distribution or a VM is the transport's knowledge, and only the flag that
    /// names the socket is the dialect's ([`crate::domain::wsl_args`] takes the engine for that one
    /// thing). A dialect implementing this would have to know how to get inside.
    ///
    /// **EMPTY means there is no bridge**, which is the common case: a native engine has a local socket
    /// and needs none. An empty argv is refused rather than spawned, so a transport that returns one by
    /// accident reports an unresolved address rather than running the wrong thing.
    /// `socket` is what [`EngineDialect::read_engine_socket`] just reported — the address INSIDE the
    /// guest, which is what the bridge points at. Passed in rather than read back off the settings
    /// because at detection time `api.connection.relay` still holds the PREVIOUS run's value: a bridge
    /// built from it would point at wherever the engine used to listen, which is the kind of defect that
    /// works until the day it does not.
    async fn resolve_dial_stdio(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
        _socket: &str,
    ) -> Vec<String> {
        Vec::new()
    }

    /// The local address to DERIVE when nothing has assigned one — `ensureRemoteForwardAddress`.
    ///
    /// A fallback, never an override, and that is the whole distinction from
    /// [`Transport::resolve_scope_uri`]: `ssh -NL` needs a path to bind, and on POSIX the original
    /// has an orchestrator fill it in before detection runs. Deriving it here instead means deriving
    /// it LAST, so a preset address still wins.
    async fn local_forward_fallback(&self, _host: &dyn HostContext) -> String {
        String::new()
    }

    /// Whether what [`Transport::start_api`] opens is this connection's DATA PLANE rather than the
    /// engine's own service — and therefore whether the caller's `start_api` flag has any say.
    ///
    /// the design's rule, and the one thing the two meanings of `start_api` do NOT share. That flag
    /// asks for the ENGINE's service, which SSH declines to start at all ("Start api skipped - not
    /// required"); the forward is what makes the resolved uri mean anything, so gating it on the same
    /// flag would leave a connection reporting `ready` on a socket with no listener. A caller that
    /// branches on the host type instead would have to know which transports those are.
    fn opens_data_plane(&self) -> bool {
        false
    }

    /// Open whatever this connection needs before a client can talk to the engine, and report whether
    /// it came up.
    ///
    /// The two hosts mean different things by it and the original keeps them in the same method:
    /// native STARTS the engine's own service (`podman system service`), SSH opens the `ssh -NL`
    /// forward. The difference that matters to the caller is what a `false` costs, and that is not a
    /// label on the service — `NativeTransport.startApi` returning `false` is forgiven because
    /// something else may already be listening, while a forward that did not open means the address
    /// this connection resolved names nothing.
    async fn start_api(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<bool>;

    async fn stop_api(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<bool>;

    /// Why a scope would not come up — `diagnostics/ssh-preflight.ts`.
    ///
    /// Asked ONLY after [`Transport::start_scope`] already reached a bad verdict, so it never costs a
    /// healthy connection anything. `None` means "I looked and everything I can check is fine",
    /// which is a real answer and a different one from any code — inventing a cause there would be
    /// worse than the generic verdict the caller already has.
    ///
    /// Defaulted because most transports have nothing to add: an unscoped host never reaches a scope
    /// verdict to be disappointed by, and a WSL distribution that will not start says so in the
    /// output of the command that failed.
    async fn diagnose_scope(
        &self,
        _host: &dyn HostContext,
        _engine_program: Option<&str>,
    ) -> Option<Diagnostic> {
        None
    }
}

/// The environment variables a native URI seed is read from. Data, not a lookup, so the seed rule
/// stays a pure function of what the caller read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EngineEnvironment {
    pub podman_host: Option<String>,
    pub docker_host: Option<String>,
}

/// Engine commands and endpoints — one per engine: Podman / Docker / Apple.
#[async_trait]
pub trait EngineDialect: Send + Sync {
    fn engine(&self) -> ContainerEngine;

    /// What this ENGINE can do, before the host it runs on is taken into account —
    /// `capabilitiesBase`.
    ///
    /// Required rather than defaulted: there is no engine-neutral answer, and a default would be one
    /// engine's table quietly standing in for another's.
    fn capabilities_base(&self) -> ConnectorCapabilities;

    /// The REST shape this dialect speaks. Apple's is `Docker`, through socktainer, while its dialect
    /// is still its own.
    fn api_surface(&self) -> ApiSurface;

    /// Where the engine says it is listening — Podman `system info` → `remoteSocket.path`, Docker
    /// `context inspect` → `Endpoints.docker.Host`.
    ///
    /// Empty when it cannot be read, exactly as the original's `catch` leaves it: a detection
    /// failure, not a crash. `settings` supplies the program to ask, which during detection is a
    /// candidate the context does not carry yet.
    async fn read_engine_socket(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> String;

    /// The flags that point this engine's CLI at the target the connection NAMED, or none when it
    /// named nothing —.
    ///
    /// Applied once, by [`HostContext::run_engine_command`], in front of whatever the caller asked
    /// for. **Required rather than defaulted**, for [`EngineDialect::dial_stdio_program`]'s reason:
    /// a fourth engine must answer whether it has a notion of a selected target instead of silently
    /// inheriting "no". Podman's analogue is `--connection`, and it answers NONE deliberately — its
    /// connections are consumed as machine SCOPES (`podman_machine_connections`), and a second way
    /// to select the same machine is a second thing able to disagree.
    fn target_args(&self, _settings: &EngineConnectorSettings) -> Vec<String>;

    /// The targets this engine offers on this host — `docker context ls`.
    ///
    /// Discovery, and it belongs beside [`Transport::list_scopes`] rather than in the engine's
    /// extension surface: enumerating what a host can be pointed at is how connections are composed,
    /// where listing the CONTAINERS behind one is resource CRUD.
    ///
    /// Defaulted to an absence, unlike [`EngineDialect::target_args`], because "this engine offers
    /// no named targets" is a complete answer that costs a caller nothing — and one an engine that
    /// has no such concept should not have to spell out.
    async fn list_contexts(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<Vec<EngineContext>> {
        Ok(Vec::new())
    }

    /// The `PODMAN_HOST` / `DOCKER_HOST` seed a native connection starts from before the engine is
    /// asked. Pure: the environment is read once by the caller and handed in.
    fn native_uri_seed(&self, environment: &EngineEnvironment) -> String;

    /// The argv `startApi` launches the engine's own service with, or `None` when the engine manages
    /// its own — Docker and Apple both answer `None`, which means "start the host manually" rather
    /// than "not implemented".
    fn build_service_args(&self, socket_path: &str, log_level: &str) -> Option<Vec<String>>;

    /// Whether this engine ships `system dial-stdio`, and the name to fall back to when the connection
    /// resolved none — `resolveDialStdioBridge`'s `settings.program.name || "podman"`.
    ///
    /// `None` is the refusal, and it is what keeps Apple out: `container.ts` has no
    /// `resolveDialStdioBridge` at all. Required rather than defaulted, so a fourth engine cannot be
    /// added without answering it. Not [`EngineDialect::describe_api_bridge`], which is socktainer —
    /// the REST bridge in FRONT of Apple's engine.
    fn dial_stdio_program(&self) -> Option<&'static str>;

    /// The API BRIDGE this engine is reached through, when it has one.
    ///
    /// Only Apple does: `container` has no REST API of its own, so socktainer serves the Docker
    /// surface in front of it and whether it is installed is a thing a client has to be able to say.
    /// Podman and Docker speak REST natively and answer `None`, which is why this is defaulted.
    ///
    /// **A [`Program`] rather than the original's English sentence.** `describeApiBridge` answers
    /// "socktainer not found — install it (`brew install socktainer`)…", and this port has nowhere
    /// to put that: `ReportedDiagnostic.params` is documented "Never prose". The two facts
    /// the sentence carries are the NAME and whether a PATH was found, and `Program` already carries
    /// both — an absent path IS "not installed", the same spelling every other lookup here uses.
    ///
    /// **Folded into `availability.report.api`**, which is where the original puts it — by
    /// `fold_api_bridge` in `domain/machine/availability.rs`. The original APPENDS a sentence to that
    /// line; a code cannot be appended to another, so an absent path BECOMES the entry
    /// (`API_BRIDGE_NOT_FOUND`), replacing the `API_UNREACHABLE` it is the cause of.
    ///
    /// A bridge that IS present explains no failure, so it is recorded as PARAMS on that same entry
    /// instead of as its code — one entry holds a verdict AND a build, because it is a code, a severity
    /// and typed parameters. Both halves of the original's sentence are therefore carried, and no
    /// report field was needed for either.
    async fn describe_api_bridge(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> Option<Program> {
        None
    }
}

/// What an API connection is composed FROM.
///
/// Grouped rather than passed as five arguments: `socket`, `scope_uri` and `local_fallback` are all
/// paths, all mean "absent" when empty, and a caller that swapped two would compose a connection that
/// looks correct and points at the wrong machine.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedApi<'a> {
    /// What the engine reported it is listening on, scheme already stripped.
    pub socket: &'a str,
    /// The `PODMAN_HOST` / `DOCKER_HOST` seed.
    pub seed: &'a str,
    /// The local address the scope IMPOSES, and so the one that outranks the settings.
    pub scope_uri: &'a str,
    /// What the connection already carries — a user may have configured an endpoint the engine
    /// cannot be asked about.
    pub configured: &'a ApiConnection,
    /// The address to derive when neither of the above supplied one. LAST, so a preset address
    /// survives detection.
    pub local_fallback: &'a str,
    /// What the PROFILE probed for itself — [`HostProfile::probe_uri`].
    pub probed: &'a str,
    /// The stdio bridge the transport resolved, or empty when there is none —
    /// [`Transport::resolve_dial_stdio`]. `getApiConnection` ranks this FIRST, and so does
    /// [`crate::domain::machine::proxy`]: when a bridge exists there is no local address to prefer.
    pub dial_stdio: &'a [String],
    /// Where the CLIENT runs.
    ///
    /// The ranking is not OS-independent, and exactly one leaf proves it: Docker Desktop's endpoint is
    /// a named PIPE on Windows and a unix socket everywhere else, and the original's
    /// `dockerVendorProfile` branches on precisely that — it does not even ASK the engine on Windows.
    pub os: OperatingSystem,
}

/// The machine the CLIENT runs on, as much of it as a gate needs to know.
///
/// `OperatingSystem` alone could not carry the question one leaf actually asks: Apple's `container`
/// runs on macOS AND on Apple silicon, and an architecture is not a property of an operating system.
/// Borrowed and `Copy` for the same reason [`ResolvedApi`] is — a gate reads it and keeps nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostPlatform<'a> {
    pub os: OperatingSystem,
    /// `Platform.getOsArch()` — node's `process.arch` (`arm64`, `x64`, …), EMPTY when unreadable.
    pub arch: &'a str,
}

/// The thin per-(engine, host) glue — one per leaf, holding only what genuinely varies per host.
#[async_trait]
pub trait HostProfile: Send + Sync {
    fn host(&self) -> ContainerEngineHost;

    fn label(&self) -> &'static str;

    /// The platform gate: whether this engine can run on the machine the CLIENT is on at all.
    ///
    /// It takes the whole [`HostPlatform`] and not an `OperatingSystem`, because eleven leaves ask
    /// about the OS and the twelfth also asks about the ARCHITECTURE. Passing the arch only to the
    /// leaf that wants it would mean a second gate method the first could contradict.
    fn is_engine_available(&self, platform: HostPlatform) -> UnitResult<()>;

    /// The engine's table, narrowed by the host it is reached through — `adjustCapabilities`.
    ///
    /// Defaulted to the base because SIX of the twelve leaves genuinely do not narrow it: every
    /// docker host answers the dialect's table verbatim, and so does podman native. The five that
    /// override are the ones with something to say — a machine that is already the guest, or a
    /// controller with a version of its own.
    fn adjust_capabilities(&self, base: ConnectorCapabilities) -> ConnectorCapabilities {
        base
    }

    /// An address only THIS leaf can find out, because it is PROBED rather than reported.
    ///
    /// Docker Desktop on Windows serves `\\.\pipe\dockerDesktopLinuxEngine` on a current install and
    /// `\\.\pipe\docker_engine` on an older one, and the only way to tell is to look — the engine is
    /// not asked at all there. Eleven of the twelve leaves have nothing to probe, which is why this is
    /// defaulted to an absence.
    ///
    /// Separate from [`HostProfile::api_connection`] so that the RANKING stays pure: a ranking free to
    /// perform I/O is a ranking free to consult a second source and disagree with itself. This
    /// resolves a candidate; `api_connection` decides what it is worth.
    async fn probe_uri(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> String {
        String::new()
    }

    /// Whether this leaf's engine socket is a HOST path, and so has to be re-spelled when this
    /// process runs inside a flatpak sandbox (`Api.clients.ts:getApiConfig`, the design's neighbour in
    /// `domain::sandbox`).
    ///
    /// **The oracle states this as a list of eight hosts; here it is the property that list encodes.**
    /// The two it leaves out are WSL and LIMA, whose sockets a sandboxed process reaches without a
    /// prefix — and a list is a thing a thirteenth connector can silently fall off, where an answer
    /// every leaf inherits is not.
    fn sandbox_maps_socket(&self) -> bool {
        true
    }

    /// Compose the API connection — the transport's scope URI ∘ the dialect's engine read.
    ///
    /// Pure, and deliberately so: the two ends of a connection are a RANKING, and a ranking that
    /// could also perform I/O would be free to consult a second source and disagree with itself.
    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection;
}
