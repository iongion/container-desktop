//! The composed client — `runtimes/host-client.ts`.
//!
//! It owns exactly one [`Transport`] × one [`EngineDialect`] × one [`HostProfile`], and IS the
//! [`HostContext`] their methods receive. Only the cross-cutting host state and the generic host
//! helpers live here; every command, socket and endpoint belongs to a unit.
//!
//! **Owning the units while handing itself to them is two SHARED borrows, and it compiles.** An
//! earlier design claimed otherwise and built a planner/executor inversion to avoid a conflict
//! that does not exist; a throwaway spike disproved it first try, including re-entrancy two levels
//! deep (client → profile → transport → client) and living in an `Arc` inside a spawned task.
//!
//! **It must never `match` on engine or on host type.** That is `facade.ts`'s rule: callers branch on
//! capability, and a branch here means logic that belongs in a unit has leaked up.

use std::sync::Arc;
use std::sync::Mutex;

use async_trait::async_trait;

use crate::capabilities::command::{Command, CommandExecutionResult, HostCommand};
use crate::capabilities::fs::Fs;
use crate::capabilities::http::Http;
use crate::domain::proxy;
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::engine::{ApiSurface, ContainerEngine, ContainerEngineHost};
use crate::domain::types::machine::ControllerScope;
use crate::domain::types::network::ProxyConfig;
use crate::domain::types::os::OperatingSystem;
use crate::runtimes::composition::{
    EngineDialect, HostContext, HostProfile, Transport, UnitResult,
};

/// The Windows executable suffix `runHostCommand` appends when a launcher lacks it.
const WINDOWS_PROGRAM_SUFFIX: &str = ".exe";

/// `printenv` — how a scoped environment variable is read (`base.ts:getScopeEnvironmentVariable`).
const PRINTENV_PROGRAM: &str = "printenv";

/// The exit code stood in for a command the host could not spawn at all.
///
/// `drive/connection.rs` used `-1` for the same case and for the same reason: no planner reads the
/// value, only `success()`, so what matters is that it is non-zero and that it is spelled once.
const SPAWN_FAILED_CODE: i32 = -1;

/// `opts?.logLevel || "warn"` — the original's fallback, spelled once.
const DEFAULT_LOG_LEVEL: &str = "warn";

/// The per-(engine, host) composition the registry resolves — `HostClientComposition`.
///
/// `PROGRAM` and `CONTROLLER` are here rather than on a unit because no single unit carries them: the
/// engine binary is the dialect's subject but not its state, and the controller belongs to a transport
/// that may be shared by two engines.
pub struct HostClientComposition {
    pub transport: Box<dyn Transport>,
    pub dialect: Box<dyn EngineDialect>,
    pub profile: Box<dyn HostProfile>,
    pub program: &'static str,
    pub controller: &'static str,
}

/// What the client needs about the machine it is running on, none of which it may read for itself.
///
/// Grouped rather than passed as five positional scalars: `home` and `user_data_path` are both
/// directories and swapping them would bind a forward socket in the user's home.
#[derive(Debug, Clone)]
pub struct HostEnvironment {
    pub os_type: OperatingSystem,
    /// `Platform.getOsArch()` — node's `process.arch`. Empty when it could not be read, which is a
    /// refusal for the one gate that asks and nothing at all to the other eleven.
    pub arch: String,
    /// Whether this process is inside a flatpak SANDBOX, and therefore reaches the host's filesystem
    /// through a prefix (`domain::sandbox`).
    ///
    /// Host knowledge, arriving as data for the same reason `arch` and `home` do: the original's own
    /// detection is `Linux && (FLATPAK_ID || /.flatpak-info)`, which is two environment reads and no
    /// capability this crate is missing.
    pub is_flatpak: bool,
    /// Where `~` and a relative `IdentityFile` resolve.
    pub home: String,
    /// `Platform.getUserDataPath()`.
    pub user_data_path: String,
    /// `opts?.logLevel || "warn"` — what the engine's own service is asked to log at.
    pub log_level: String,
    /// The APP's version, for the `User-Agent` every request to the engine carries. Empty means a
    /// host that never said, and the header is then omitted rather than sent half-filled.
    pub app_version: String,
    /// This connection's EFFECTIVE proxy — the global one, its own, or none, resolved once by whoever
    /// built this (`domain::proxy::resolve_connection`).
    ///
    /// Resolved rather than the two halves, for the reason the scope is: a value that arrives already
    /// decided cannot be decided differently twice. It is the connection's own setting joined with the
    /// global, so it is read from the connection the user saved and never from what detection
    /// produced — detection has nothing to say about a proxy.
    pub proxy: ProxyConfig,
}

impl Default for HostEnvironment {
    /// `OperatingSystem::Unknown` rather than a derived default, because `OperatingSystem` has no
    /// sensible zero: `Browser` is the first variant and defaulting to it would silently claim a
    /// wasm host. An unknown OS fails the profile's gate, which is the safe answer.
    fn default() -> Self {
        Self {
            os_type: OperatingSystem::Unknown,
            is_flatpak: false,
            arch: String::new(),
            home: String::new(),
            user_data_path: String::new(),
            log_level: DEFAULT_LOG_LEVEL.to_string(),
            app_version: String::new(),
            // Disabled, with this machine's own addresses already bypassed — what a document that
            // never mentioned a proxy means.
            proxy: proxy::normalize(None),
        }
    }
}

pub struct HostClient {
    id: String,
    engine: ContainerEngine,
    host: ContainerEngineHost,
    label: &'static str,
    program: String,
    controller: String,
    api_surface: ApiSurface,
    environment: HostEnvironment,
    transport: Box<dyn Transport>,
    dialect: Box<dyn EngineDialect>,
    profile: Box<dyn HostProfile>,
    /// The scope this connection resolved, as a value. Resolved by the caller together with the name
    /// in `settings.controller.scope`.
    scope: Option<ControllerScope>,
    /// Interior-mutable because the context is handed out as `&dyn HostContext` while detection
    /// replaces what it holds. The guard is never held across an `await` — every use reads or writes
    /// and drops immediately, which is what keeps the client `Sync`.
    settings: Mutex<EngineConnectorSettings>,
    command: Arc<dyn Command>,
    fs: Arc<dyn Fs>,
    http: Arc<dyn Http>,
}

impl HostClient {
    pub fn new(
        id: impl Into<String>,
        composition: HostClientComposition,
        environment: HostEnvironment,
        settings: EngineConnectorSettings,
        command: Arc<dyn Command>,
        fs: Arc<dyn Fs>,
        http: Arc<dyn Http>,
    ) -> Self {
        Self {
            id: id.into(),
            engine: composition.dialect.engine(),
            host: composition.profile.host(),
            label: composition.profile.label(),
            program: composition.program.to_string(),
            controller: composition.controller.to_string(),
            api_surface: composition.dialect.api_surface(),
            environment,
            transport: composition.transport,
            dialect: composition.dialect,
            profile: composition.profile,
            scope: None,
            settings: Mutex::new(settings),
            command,
            fs,
            http,
        }
    }

    /// Adopt the scope this attempt resolved.
    pub fn with_scope(mut self, scope: Option<ControllerScope>) -> Self {
        self.scope = scope;
        self
    }

    /// The same client, sandboxed — see [`crate::domain::sandbox`].
    pub fn in_flatpak(mut self) -> Self {
        self.environment.is_flatpak = true;
        self
    }

    pub fn engine(&self) -> ContainerEngine {
        self.engine
    }

    pub fn host(&self) -> ContainerEngineHost {
        self.host
    }

    pub fn label(&self) -> &'static str {
        self.label
    }

    /// The REST shape this host speaks, which the adapters select a base URL and normalizers from.
    pub fn api_surface(&self) -> ApiSurface {
        self.api_surface
    }

    /// `runHostCommand`'s launcher rule: Windows appends `.exe` when the program lacks it.
    ///
    /// Applied to the launcher only. An argument that happens to name a program — `which podman` —
    /// must not be rewritten, which is why this is not a pass over the whole argv.
    fn launcher_for(&self, program: &str) -> String {
        if self.environment.os_type == OperatingSystem::WindowsNt
            && !program.ends_with(WINDOWS_PROGRAM_SUFFIX)
        {
            return format!("{program}{WINDOWS_PROGRAM_SUFFIX}");
        }
        program.to_string()
    }
}

#[async_trait]
impl HostContext for HostClient {
    fn id(&self) -> &str {
        &self.id
    }

    fn os_type(&self) -> OperatingSystem {
        self.environment.os_type
    }

    fn arch(&self) -> &str {
        &self.environment.arch
    }

    fn is_flatpak(&self) -> bool {
        self.environment.is_flatpak
    }

    fn transport(&self) -> &dyn Transport {
        self.transport.as_ref()
    }

    fn dialect(&self) -> &dyn EngineDialect {
        self.dialect.as_ref()
    }

    fn profile(&self) -> &dyn HostProfile {
        self.profile.as_ref()
    }

    fn program(&self) -> &str {
        &self.program
    }

    fn controller(&self) -> &str {
        &self.controller
    }

    fn scope(&self) -> Option<&ControllerScope> {
        self.scope.as_ref()
    }

    fn home(&self) -> &str {
        &self.environment.home
    }

    fn user_data_path(&self) -> &str {
        &self.environment.user_data_path
    }

    fn log_level(&self) -> &str {
        &self.environment.log_level
    }

    fn app_version(&self) -> &str {
        &self.environment.app_version
    }

    fn engine_proxy_env(&self) -> Vec<(String, String)> {
        if self.is_scoped() {
            return Vec::new();
        }
        proxy::to_env(&self.environment.proxy)
    }

    fn command(&self) -> &dyn Command {
        self.command.as_ref()
    }

    fn fs(&self) -> &dyn Fs {
        self.fs.as_ref()
    }

    fn http(&self) -> &dyn Http {
        self.http.as_ref()
    }

    async fn settings(&self) -> EngineConnectorSettings {
        self.settings.lock().expect("settings").clone()
    }

    async fn set_settings(&self, settings: EngineConnectorSettings) {
        *self.settings.lock().expect("settings") = settings;
    }

    /// `host-client.ts:runHostCommand` — the `.exe` rule, then the proxy-environment rule, then run.
    ///
    /// The launcher is rewritten here and nowhere else, so a unit that builds a [`HostCommand`] never
    /// has to know what OS it is on.
    ///
    /// **A command that could not be spawned is a FAILED RESULT, not an error**, and that is the
    /// original's contract rather than a convenience: `Command.Execute` catches and returns
    /// `{ success: false }`, which is why `which podman` on a machine without podman records a
    /// non-zero exit instead of throwing. Every caller asks `success()`; a machine with no engine
    /// installed must reach a diagnostic through detection, not through an exception that skips it.
    async fn run_host_command(&self, command: &HostCommand) -> CommandExecutionResult {
        let mut resolved = command.clone();
        resolved.launcher = self.launcher_for(&command.launcher);
        // The proxy FIRST and the caller's own env after it, which is `buildSpawnEnv`'s order
        // (`deepMerge({}, process.env, proxyEnv, opts.env)`): a command that names a variable itself
        // means it, and the proxy is the default it is overriding.
        resolved.env = self
            .engine_proxy_env()
            .into_iter()
            .chain(command.env.iter().cloned())
            .collect();
        match self.command.run(&resolved).await {
            Ok(outcome) => outcome,
            Err(error) => CommandExecutionResult::failed(SPAWN_FAILED_CODE, error.to_string()),
        }
    }

    async fn run_scope_command(
        &self,
        program: &str,
        args: &[String],
        settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult> {
        self.transport
            .run_scope_command(self, program, args, settings)
            .await
    }

    /// `base.ts:getScopeEnvironmentVariable`.
    ///
    /// Empty for an unscoped host, and empty when the read fails — both are the original's behaviour,
    /// and every caller treats an empty answer as a reason to fall back rather than to fail.
    async fn scope_environment_variable(
        &self,
        variable: &str,
        settings: &EngineConnectorSettings,
    ) -> String {
        if !self.is_scoped() {
            return String::new();
        }
        let args = vec![variable.to_string()];
        match self
            .run_scope_command(PRINTENV_PROGRAM, &args, settings)
            .await
        {
            Ok(output) if output.success() => output.stdout.trim().to_string(),
            _ => String::new(),
        }
    }
}
