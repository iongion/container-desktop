//! `runtimes/transports/native.ts` — the host runs the engine directly, with no scope.
//!
//! Every method is present and the scope operations are absences rather than omissions, which is
//! `facade.ts`'s "maximize symmetry, even with no-ops": a caller asks every transport the same
//! questions and branches on the answer, never on the host type.

use std::path::Path;
use std::time::Duration;

use async_trait::async_trait;

use crate::capabilities::command::{CommandExecutionResult, ServiceId};
use crate::capabilities::command::{HostCommand, Retry, ServiceOpts};
use crate::domain::diagnostic::Diagnostic;
use crate::domain::sandbox::host_path;
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::diagnostic::DiagnosticCode;
use crate::domain::types::host::StartupStatus;
use crate::domain::types::machine::ControllerScope;
use crate::runtimes::composition::{HostContext, Transport, UnitResult};
use crate::runtimes::dialects::shared::normalize_unix_socket_path;
use crate::runtimes::transports::shared::{api_answers, program_launcher};

/// `Runner.startApi`'s `retry: { count: 10, wait: 5000 }` — how long the engine's own service is
/// given to start listening.
pub const API_READINESS_ATTEMPTS: u32 = 10;

/// The wait between those attempts.
pub const API_READINESS_WAIT: Duration = Duration::from_secs(5);

/// The service a connection's engine API is spawned under.
///
/// Qualified with the connection id — `api:host.manual.podman.native`, never bare `api` — so a
/// teardown kills the forward THIS connection opened and not another connection's.
pub fn api_service_id(connection_id: &str) -> ServiceId {
    ServiceId(format!("api:{connection_id}"))
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct NativeTransport;

#[async_trait]
impl Transport for NativeTransport {
    fn is_scoped(&self) -> bool {
        false
    }

    /// "Scope is not supported in native mode" — the original throws, and a native host has no scope
    /// to name, so the code is `SCOPE_NOT_SET` with what was being attempted.
    async fn run_scope_command(
        &self,
        _host: &dyn HostContext,
        program: &str,
        _args: &[String],
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult> {
        Err(Diagnostic::with_params(
            DiagnosticCode::ScopeNotSet,
            serde_json::json!({ "transport": "native", "program": program }),
        ))
    }

    /// There is no guest, so a local path is already the path.
    async fn resolve_guest_path(&self, _host: &dyn HostContext, local_path: &str) -> String {
        local_path.to_string()
    }

    /// A native host offers no scopes.
    ///
    /// The original answers `getPodmanMachines()` for podman-native, gated on the `machines`
    /// extension capability. That is the engine-extension surface, which stays in `container-client`
    /// — and it is a LIST of machines to choose from, not a scope this connection enters. Empty is the
    /// honest answer for both engines; docker-native answers empty there too.
    async fn list_scopes(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<Vec<ControllerScope>> {
        Ok(Vec::new())
    }

    async fn controller_default_scope(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<Option<ControllerScope>> {
        Ok(None)
    }

    /// Nothing to start, and `Error` rather than `Running` is the original's answer: it logs
    /// "Scope is not supported in native mode" and returns `StartupStatus.ERROR`. A caller that
    /// asked an unscoped host to start a scope asked the wrong question.
    async fn start_scope(&self, _host: &dyn HostContext) -> UnitResult<StartupStatus> {
        Ok(StartupStatus::Error)
    }

    async fn stop_scope(&self, _host: &dyn HostContext) -> UnitResult<bool> {
        Ok(false)
    }

    /// No opinion: a native client reaches the engine's own socket, so nothing is imposed.
    async fn resolve_scope_uri(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
        _socket: &str,
    ) -> String {
        String::new()
    }

    /// Start the engine's own API service — `podman system service`.
    ///
    /// **A `false` here is forgiven by the caller, and that is the whole difference from a scoped
    /// host's data plane.** Something outside the app may already have started the engine, so the
    /// availability check decides; the original catches `startApi` and carries on for exactly this
    /// reason. An `ssh -NL` forward gets no such benefit, because nothing else can have opened it.
    async fn start_api(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<bool> {
        let socket_path = normalize_unix_socket_path(&settings.api.connection.uri);
        let Some(service_args) = host
            .dialect()
            .build_service_args(&socket_path, host.log_level())
        else {
            // Docker and Apple manage their own service: there is nothing to launch, and the user
            // must start the host manually.
            return Ok(false);
        };
        if socket_path.is_empty() {
            // `podman system service unix://` would bind nothing. Detection not having resolved an
            // address is the failure, and naming it here beats spawning a service that cannot listen.
            return Err(Diagnostic::new(DiagnosticCode::ApiSocketUnresolved));
        }
        ensure_socket_directory(host, &socket_path)?;

        let command = HostCommand {
            launcher: program_launcher(settings).to_string(),
            args: service_args,
            // The service outlives the call that starts it, so it carries no timeout. It carries the
            // proxy environment because a native host IS unscoped (`proxyEnv: true` in the original),
            // and without it a service behind a corporate proxy can pull nothing — this is a spawn of
            // its own and does not pass through `run_host_command`, which is where every other
            // command picks the same variables up.
            env: host.engine_proxy_env(),
            ..HostCommand::default()
        };
        let opts = ServiceOpts {
            retry: Retry {
                count: API_READINESS_ATTEMPTS,
                wait: API_READINESS_WAIT,
            },
            check_status: api_answers(&socket_path, settings, host),
        };
        match host
            .command()
            .spawn_service(&api_service_id(host.id()), &command, &opts)
            .await
        {
            Ok(()) => Ok(true),
            // Forgiven, as above: the engine may already be listening. The availability check is
            // what decides, and inventing a diagnostic here would pre-empt it.
            Err(_) => Ok(false),
        }
    }

    async fn stop_api(
        &self,
        host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<bool> {
        Ok(host
            .command()
            .kill(&api_service_id(host.id()))
            .await
            .is_ok())
    }
}

/// Create the directory the socket will be bound in, if it is not already there.
///
/// Podman does not create its listening socket's base directory, which is the comment the original
/// carries here.
///
/// **Inside a flatpak the host's copy of that directory is created too**, and FIRST, which is the
/// original's order: the engine binds the socket in the HOST's namespace, so the directory that has
/// to exist for it is the prefixed one, while the unprefixed path is what this process later checks.
/// Creating only one of the two is why this was worth porting rather than leaving named.
fn ensure_socket_directory(host: &dyn HostContext, socket_path: &str) -> UnitResult<()> {
    let Some(directory) = Path::new(socket_path).parent() else {
        return Ok(());
    };
    if directory.as_os_str().is_empty() {
        return Ok(());
    }
    if host.is_flatpak() {
        let sandboxed = host_path(&directory.to_string_lossy(), true);
        make_directory(host, Path::new(&sandboxed))?;
    }
    if host.fs().is_file_present(directory) {
        return Ok(());
    }
    make_directory(host, directory)
}

fn make_directory(host: &dyn HostContext, directory: &Path) -> UnitResult<()> {
    host.fs().mkdir(directory).map_err(|error| {
        Diagnostic::with_params(
            DiagnosticCode::ApiSocketUnresolved,
            serde_json::json!({ "path": directory.to_string_lossy(), "reason": error.to_string() }),
        )
    })
}
