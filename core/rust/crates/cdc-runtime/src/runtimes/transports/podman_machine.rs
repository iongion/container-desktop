//! `runtimes/transports/podman-machine.ts` — Podman's own vendor virtualization.
//!
//! The scope is a MACHINE, entered with `podman machine ssh <scope> -o LogLevel=ERROR …`. Podman-only:
//! Docker's vendor host is UNSCOPED and uses the native transport, which is the asymmetry the connector
//! table exists to keep straight.
//!
//! **`start_api` starts the MACHINE, not a service inside it** (`podman machine start`), so
//! [`Transport::opens_data_plane`] keeps its `false` default: the caller's `start_api` flag decides
//! whether it is asked, and a machine that will not start is forgiven, because something outside this
//! app may have started it already.
//!
//! The engine-extension surface the original reaches for here (`getPodmanMachines`,
//! `getPodmanMachineInspect`, `startPodmanMachine`) is a RESOURCE surface and stays out — but the
//! two commands behind it are plain `podman machine …` invocations, and a transport that could not
//! enter or start its own scope would not be a transport. So they are run here, and the extension
//! methods will be the same commands when the resource work arrives.

use async_trait::async_trait;

use crate::capabilities::command::{CommandExecutionResult, HostCommand, Retry, ServiceOpts};
use crate::domain::diagnostic::Diagnostic;
use crate::domain::pathing::join;
use crate::domain::ssh::forward::{is_named_pipe, windows_pipe_path};
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::diagnostic::DiagnosticCode;
use crate::domain::types::host::StartupStatus;
use crate::domain::types::machine::{ControllerScope, PodmanMachine};
use crate::domain::types::os::{ControllerScopeType, OperatingSystem};
use crate::runtimes::composition::{HostContext, Transport, UnitResult};
use crate::runtimes::dialects::podman_machine_connections::{
    PodmanSystemConnection, SYSTEM_CONNECTION_LIST_ARGS, parse_system_connections,
    select_default_machine_scope_name,
};
use crate::runtimes::dialects::podman_machine_pipe::parse_podman_machine_named_pipe;
use crate::runtimes::dialects::shared::normalize_unix_socket_path;
use crate::runtimes::transports::native::{
    API_READINESS_ATTEMPTS, API_READINESS_WAIT, api_service_id,
};
use crate::runtimes::transports::shared::{api_answers, controller_launcher};

/// `-o LogLevel=ERROR` — the nested `ssh` podman runs would otherwise print its own notices into the
/// output the caller parses as the engine's.
pub const MACHINE_SSH_LOG_LEVEL: &str = "LogLevel=ERROR";

/// Where podman keeps a machine's API socket on POSIX, relative to the home directory.
///
/// The default one first, then the per-machine one when it is actually there — which is the order the
/// original probes them in, and the reason both are named: a machine that has its own socket is reached
/// on it, and one that does not is reached on podman's shared default.
pub const MACHINE_SOCKET_BASE: &str = ".local/share/containers/podman/machine";
pub const MACHINE_SOCKET_NAME: &str = "podman.sock";

/// `shared.ts:normalizePodmanMachines` — the machines podman listed.
///
/// `Type` and `Usable` are ADDED here, exactly as the original adds them: `podman machine list` reports
/// neither, and `Usable` IS `Running`. An entry podman printed without the fields the schema requires
/// is dropped rather than failing the whole list — one malformed machine must not hide the others.
pub fn podman_machines(stdout: &str) -> Vec<PodmanMachine> {
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(stdout) else {
        return Vec::new();
    };
    items
        .into_iter()
        .filter_map(|mut item| {
            let running = item
                .get("Running")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let entry = item.as_object_mut()?;
            entry.insert("Type".to_string(), serde_json::json!("PodmanMachine"));
            entry.insert("Usable".to_string(), serde_json::json!(running));
            serde_json::from_value(item).ok()
        })
        .collect()
}

/// The address `podman machine inspect` reports for a machine, out of the inspect output.
///
/// A named PIPE wins, because that is how podman reports a machine on Windows and it is the only
/// address a native Windows process can dial. The in-VM unix socket must NEVER overwrite a pipe that
/// was already resolved: it is not reachable from Windows at all, and clobbering it is exactly what
/// left podman "not reachable" before the original's comment was written.
pub fn machine_address(stdout: &str, name: &str, resolved: &str) -> String {
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(stdout) else {
        return resolved.to_string();
    };
    let Some(machine) = items
        .iter()
        .find(|item| item.get("Name").and_then(serde_json::Value::as_str) == Some(name))
    else {
        return resolved.to_string();
    };
    let at = |pointer: &str| {
        machine
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
    };
    let pipe = at("/ConnectionInfo/PodmanPipe/Path");
    if !pipe.is_empty() {
        return pipe.to_string();
    }
    if is_named_pipe(resolved) {
        return resolved.to_string();
    }
    let socket = at("/ConnectionInfo/PodmanSocket/Path");
    if socket.is_empty() {
        return resolved.to_string();
    }
    socket.to_string()
}

/// Whether the machine `podman machine inspect` describes is already up.
pub fn machine_is_running(stdout: &str, name: &str) -> bool {
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(stdout) else {
        return false;
    };
    items.iter().any(|item| {
        item.get("Name").and_then(serde_json::Value::as_str) == Some(name)
            && item.get("State").and_then(serde_json::Value::as_str) == Some("running")
    })
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PodmanMachineTransport;

#[async_trait]
impl Transport for PodmanMachineTransport {
    fn is_scoped(&self) -> bool {
        true
    }

    /// Machines take a long time to stop and start, so one this app started is left running — the
    /// original's reason, verbatim, and the opposite of a WSL distribution's answer.
    fn should_keep_started_scope_running(&self) -> bool {
        true
    }

    /// `podman machine ssh <scope> -o LogLevel=ERROR <program> <args…>`.
    async fn run_scope_command(
        &self,
        host: &dyn HostContext,
        program: &str,
        args: &[String],
        settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult> {
        let machine = machine(host, Some(program))?;
        let command = scope_command(host, settings, &machine.name, program, args);
        Ok(host.run_host_command(&command).await)
    }

    /// A machine mounts `$HOME` at the same path, so a local path is already valid inside it.
    async fn resolve_guest_path(&self, _host: &dyn HostContext, local_path: &str) -> String {
        local_path.to_string()
    }

    /// `podman machine list --format json`.
    async fn list_scopes(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<Vec<ControllerScope>> {
        let outcome = host
            .run_host_command(&machine_command(
                host,
                settings,
                &["list", "--format", "json"],
            ))
            .await;
        if !outcome.success() {
            return Ok(Vec::new());
        }
        Ok(podman_machines(&outcome.stdout)
            .into_iter()
            .map(ControllerScope::PodmanMachine)
            .collect())
    }

    /// The machine behind podman's own DEFAULT CONNECTION, which is not the same question as "the first
    /// machine": podman's default may be the rootful `-root` connection, and this app targets rootless.
    async fn controller_default_scope(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<Option<ControllerScope>> {
        let connections = self.system_connections(host, settings).await;
        let machines = self.list_scopes(host, settings).await?;
        let names: Vec<String> = machines.iter().filter_map(machine_name).collect();
        // The original LOGS how this was decided; `cdc-runtime` has no logger — it is host-free, and
        // the design's `tracing` lives in the host crates — so the decision travels as the returned
        // [`DefaultMachineScope`] instead, where a caller can render it and a test can assert it.
        let choice = select_default_machine_scope_name(&connections, &names);
        let Some(chosen) = choice.machine() else {
            return Ok(None);
        };
        Ok(machines.into_iter().find(|scope| {
            machine_name(scope).is_some_and(|name| name.eq_ignore_ascii_case(chosen))
        }))
    }

    /// `startPodmanMachine` — inspect first, then `podman machine start <scope>`.
    ///
    /// The inspect is what tells `Running` from `Started`, and the difference decides whether this app
    /// shuts the machine down again. A machine that cannot be inspected is not assumed to be down: the
    /// original logs the failure and starts it anyway, and `podman machine start` on a running machine
    /// is refused by podman itself rather than by a guess made here.
    async fn start_scope(&self, host: &dyn HostContext) -> UnitResult<StartupStatus> {
        let machine = machine(host, None)?.clone();
        let settings = host.settings().await;
        let inspect = host
            .run_host_command(&machine_command(
                host,
                &settings,
                &["inspect", &machine.name],
            ))
            .await;
        if inspect.success() && machine_is_running(&inspect.stdout, &machine.name) {
            return Ok(StartupStatus::Running);
        }
        let started = host
            .run_host_command(&machine_command(host, &settings, &["start", &machine.name]))
            .await;
        if started.success() {
            return Ok(StartupStatus::Started);
        }
        Ok(StartupStatus::Error)
    }

    /// `podman machine stop <scope>`.
    async fn stop_scope(&self, host: &dyn HostContext) -> UnitResult<bool> {
        let machine = machine(host, None)?.clone();
        let settings = host.settings().await;
        Ok(host
            .run_host_command(&machine_command(host, &settings, &["stop", &machine.name]))
            .await
            .success())
    }

    /// The address the MACHINE imposes — `resolveScopeURI`.
    ///
    /// Three sources, in the order the original consults them. On Windows: podman's OWN named pipe when
    /// it lists one (newer podman), else the app's relay pipe, which a bridge has to serve. On POSIX:
    /// podman's shared machine socket, refined to the per-machine one when that file is there. Then
    /// `machine inspect` refines either — a pipe it reports wins, and an in-VM socket never overwrites a
    /// pipe already resolved.
    ///
    /// The original computes a `userConfiguration.getStoragePath()` candidate first and then overwrites
    /// it in BOTH branches — dead in the oracle, and not carried here.
    async fn resolve_scope_uri(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
        _socket: &str,
    ) -> String {
        let scope = crate::runtimes::transports::shared::named_scope(settings);
        let resolved = if host.os_type() == OperatingSystem::WindowsNt {
            let connections = self.system_connections(host, settings).await;
            parse_podman_machine_named_pipe(&connections)
                .unwrap_or_else(|| windows_pipe_path(scope))
        } else {
            self.posix_machine_socket(host, scope)
        };
        if scope.is_empty() {
            return resolved;
        }
        let inspect = host
            .run_host_command(&machine_command(host, settings, &["inspect", scope]))
            .await;
        if !inspect.success() {
            return resolved;
        }
        machine_address(&inspect.stdout, scope, &resolved)
    }

    /// `podman machine start <scope>`, waited on until the address it exposes is there.
    ///
    /// The uri rather than the relay, unlike a WSL host's: what a machine exposes IS local — a pipe on
    /// Windows, a socket under the home directory on POSIX — so the local path check is the honest
    /// question here. `GET /_ping` replaces it.
    async fn start_api(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<bool> {
        let machine = machine(host, None)?.clone();
        let address = normalize_unix_socket_path(&settings.api.connection.uri);
        if address.is_empty() {
            return Err(Diagnostic::new(DiagnosticCode::ApiSocketUnresolved));
        }
        let command = machine_command(host, settings, &["start", &machine.name]);
        let opts = ServiceOpts {
            retry: Retry {
                count: API_READINESS_ATTEMPTS,
                wait: API_READINESS_WAIT,
            },
            check_status: api_answers(&address, settings, host),
        };
        match host
            .command()
            .spawn_service(&api_service_id(host.id()), &command, &opts)
            .await
        {
            Ok(()) => Ok(true),
            // Forgiven, as a native engine's service is: the machine may already be running, and the
            // availability check is what decides.
            Err(_) => Ok(false),
        }
    }

    /// The MACHINE is deliberately left running — see [`Transport::should_keep_started_scope_running`].
    /// What is torn down is the service this attempt spawned, which is the `machine start` itself.
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

impl PodmanMachineTransport {
    /// `podman system connection list --format json` — the list every machine selection reads.
    ///
    /// Empty when it cannot be read, as the original's `catch` leaves it: a connection list that cannot
    /// be parsed is not a reason to refuse, it is a reason to fall back to the machine list.
    async fn system_connections(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> Vec<PodmanSystemConnection> {
        let command = HostCommand {
            launcher: controller_launcher(settings, host.controller()).to_string(),
            args: SYSTEM_CONNECTION_LIST_ARGS.map(str::to_string).to_vec(),
            ..HostCommand::default()
        };
        let outcome = host.run_host_command(&command).await;
        if !outcome.success() {
            return Vec::new();
        }
        parse_system_connections(&outcome.stdout)
    }

    /// Podman's machine socket under the home directory: the shared one, refined to the machine's own
    /// when that file exists.
    fn posix_machine_socket(&self, host: &dyn HostContext, scope: &str) -> String {
        let os = host.os_type();
        let base = join(os, host.home(), MACHINE_SOCKET_BASE);
        let shared = join(os, &base, MACHINE_SOCKET_NAME);
        if scope.is_empty() {
            return shared;
        }
        let per_machine = join(os, &join(os, &base, scope), MACHINE_SOCKET_NAME);
        if host
            .fs()
            .is_file_present(std::path::Path::new(&per_machine))
        {
            return per_machine;
        }
        shared
    }
}

/// The machine this connection entered, or the reason it did not.
///
/// A scope resolves by NAME, so what arrives can be a distribution or an SSH host that happens to be
/// called the same thing — each refused by KIND, in the schema's own vocabulary.
fn machine<'a>(
    host: &'a dyn HostContext,
    program: Option<&str>,
) -> Result<&'a PodmanMachine, Diagnostic> {
    let kind = match host.scope() {
        Some(ControllerScope::PodmanMachine(scope)) => return Ok(scope),
        Some(ControllerScope::WslDistribution(_)) => ControllerScopeType::WslDistribution,
        Some(ControllerScope::LimaInstance(_)) => ControllerScopeType::LimaInstance,
        Some(ControllerScope::SshHost(_)) => ControllerScopeType::SshConnection,
        None => {
            return Err(Diagnostic::with_params(
                DiagnosticCode::ScopeNotSet,
                serde_json::json!({
                    "transport": "podman-machine",
                    "program": program.unwrap_or_default(),
                }),
            ));
        }
    };
    Err(Diagnostic::with_params(
        DiagnosticCode::ScopeNotSet,
        serde_json::json!({ "transport": "podman-machine", "scope": kind.to_string() }),
    ))
}

/// This scope's name IF it is a podman machine, and nothing for any other kind.
///
/// The doc used to say "whatever kind it is", which is the opposite of what it does and exactly the
/// misreading that matters: selection matches a NAME the settings carry against the scopes a host
/// offers, so `None` means "not mine", not "unnamed". A version that answered for every kind would
/// let this transport adopt a WSL distribution called `podman-machine-default`. It is the
/// machine-specific half of [`crate::runtimes::transports::shared::scope_name`], and `pub` for the
/// same reason that one is.
pub fn machine_name(scope: &ControllerScope) -> Option<String> {
    match scope {
        ControllerScope::PodmanMachine(machine) => Some(machine.name.clone()),
        _ => None,
    }
}

/// `podman machine ssh <machine> -o LogLevel=ERROR <program> <args…>`.
///
/// Infallible, unlike the WSL wrapper's: podman is both the engine and the controller here, so the
/// launcher always has the registered `podman` to fall back on.
fn scope_command(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
    machine: &str,
    program: &str,
    args: &[String],
) -> HostCommand {
    let mut argv = vec![
        "machine".to_string(),
        "ssh".to_string(),
        machine.to_string(),
        "-o".to_string(),
        MACHINE_SSH_LOG_LEVEL.to_string(),
    ];
    if !program.is_empty() {
        argv.push(program.to_string());
    }
    argv.extend(args.iter().cloned());
    HostCommand {
        launcher: controller_launcher(settings, host.controller()).to_string(),
        args: argv,
        ..HostCommand::default()
    }
}

/// One `podman machine …` invocation on THIS machine — `machine list`, `machine inspect`,
/// `machine start`, `machine stop`.
fn machine_command(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
    args: &[&str],
) -> HostCommand {
    let mut argv = vec!["machine".to_string()];
    argv.extend(args.iter().map(|it| (*it).to_string()));
    HostCommand {
        launcher: controller_launcher(settings, host.controller()).to_string(),
        args: argv,
        ..HostCommand::default()
    }
}
