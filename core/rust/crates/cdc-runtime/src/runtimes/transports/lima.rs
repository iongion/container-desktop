//! `runtimes/transports/lima.ts` — the engine runs inside a LIMA instance, which is the scope.
//!
//! Every operation is `limactl shell <scope> …`. Engine-agnostic, unlike WSL's: both Podman-LIMA and
//! Docker-LIMA start the INSTANCE the same way, and neither starts a service inside it — which is why
//! `start_api` here does not consult the dialect at all.
//!
//! **`start_api` starts the instance**, so [`Transport::opens_data_plane`] keeps its `false` default:
//! the caller's flag decides whether it is asked, and a failure is forgiven because the instance may
//! already be up.
//!
//! The API address is asked of LIMA, never composed from the instance's name.

use async_trait::async_trait;

use crate::capabilities::command::{CommandExecutionResult, HostCommand, Retry, ServiceOpts};
use crate::domain::diagnostic::Diagnostic;
use crate::domain::pathing::join;
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::diagnostic::DiagnosticCode;
use crate::domain::types::host::StartupStatus;
use crate::domain::types::machine::{ControllerScope, LimaInstance, LimaInstanceType};
use crate::domain::types::os::{ControllerScopeType, OperatingSystem};
use crate::runtimes::composition::{HostContext, Transport, UnitResult};
use crate::runtimes::transports::native::{
    API_READINESS_ATTEMPTS, API_READINESS_WAIT, api_service_id,
};
use crate::runtimes::transports::shared::{api_answers, controller_launcher, named_scope};

/// Only [`LimaTransport::resolve_scope_uri`]'s fallback composes a path from these.
pub const LIMA_SOCKET_BASE: &str = ".lima";
pub const LIMA_SOCKET_DIRECTORY: &str = "sock";

/// The state `limactl list` prints for an instance that is up.
pub const LIMA_RUNNING_STATE: &str = "Running";

/// How many lines of `limactl list` are the table HEADER.
pub const INSTANCES_HEADER_LINES: usize = 1;

/// `shared.ts:getAvailableLIMAInstances` — the instances in what `limactl list` printed.
///
/// A column-aligned table, not JSON: `limactl list --json` exists, but the original scrapes the plain
/// listing and its COLUMN ORDER is therefore the contract — name, status, ssh, arch, cpus, memory,
/// disk, dir. A row that names nothing is dropped, where the original would produce an instance whose
/// every field is `undefined`.
pub fn lima_instances(stdout: &str) -> Vec<LimaInstance> {
    let trimmed = stdout.trim();
    let Some(header) = trimmed.lines().next() else {
        return Vec::new();
    };
    let columns: Vec<&str> = header.split_whitespace().collect();
    trimmed
        .lines()
        .skip(INSTANCES_HEADER_LINES)
        .filter_map(|line| instance_from_line(&columns, line))
        .collect()
}

/// One `limactl list` row, read by the HEADER rather than by position.
///
/// limactl 2.2.0 prints a `VMTYPE` column between `SSH` and `ARCH` that neither tree knew about, and a
/// positional read shifted every field after it — the arch took the VM type and the directory fell off
/// the end. Only `NAME` and `STATUS` are before it, which is why nothing noticed. Reading by name also
/// survives the next column lima adds.
fn instance_from_line(columns: &[&str], line: &str) -> Option<LimaInstance> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    let column = |name: &str| {
        columns
            .iter()
            .position(|it| it.eq_ignore_ascii_case(name))
            .and_then(|at| fields.get(at))
            .unwrap_or(&"")
            .to_string()
    };
    let name = fields.first()?;
    let status = column("STATUS");
    Some(LimaInstance {
        name: (*name).to_string(),
        type_: LimaInstanceType::LimaInstance,
        // `Status === "Running"`, and an absent status is not running.
        usable: Some(status == LIMA_RUNNING_STATE),
        status,
        ssh: column("SSH"),
        arch: column("ARCH"),
        cp_us: column("CPUS"),
        memory: column("MEMORY"),
        disk: column("DISK"),
        dir: column("DIR"),
    })
}

/// `limactl list --format json <name>`, narrowed to what names a socket.
#[derive(::serde::Deserialize)]
struct InstanceReport {
    config: Option<InstanceConfig>,
}

#[derive(::serde::Deserialize)]
struct InstanceConfig {
    /// `Option`, not `#[serde(default)]`: LIMA prints an explicit `null` here.
    #[serde(rename = "portForwards")]
    port_forwards: Option<Vec<PortForward>>,
}

#[derive(::serde::Deserialize)]
struct PortForward {
    #[serde(rename = "guestSocket", default)]
    guest_socket: String,
    #[serde(rename = "hostSocket", default)]
    host_socket: String,
}

/// The host socket LIMA forwards for the engine listening on `guest`.
///
/// `hostSocket` is the TEMPLATE's name, not the instance's, and it may carry `{{.Home}}`,
/// `{{.Name}}`, `{{.User}}` or `{{.Param.*}}` — so only LIMA can resolve it. Matching `guestSocket`
/// against what the engine reported is what tells two engines in one instance apart; without a
/// match the first forwarded socket wins, which is LIMA's own precedence.
pub fn forwarded_socket(stdout: &str, guest: &str) -> String {
    let Some(line) = stdout.lines().find(|line| !line.trim().is_empty()) else {
        return String::new();
    };
    let Ok(report) = serde_json::from_str::<InstanceReport>(line) else {
        return String::new();
    };
    let forwards: Vec<PortForward> = report
        .config
        .and_then(|config| config.port_forwards)
        .unwrap_or_default()
        .into_iter()
        .filter(|forward| !forward.host_socket.is_empty())
        .collect();
    if !guest.is_empty()
        && let Some(mine) = forwards
            .iter()
            .find(|forward| forward.guest_socket == guest)
    {
        return mine.host_socket.clone();
    }
    forwards
        .into_iter()
        .next()
        .map(|forward| forward.host_socket)
        .unwrap_or_default()
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LimaTransport;

#[async_trait]
impl Transport for LimaTransport {
    fn is_scoped(&self) -> bool {
        true
    }

    /// An instance this app started is left running, as a podman machine is: a VM that takes a minute
    /// to boot is not something to shut down behind a user's back.
    fn should_keep_started_scope_running(&self) -> bool {
        true
    }

    /// `limactl shell <scope> <program> <args…>`.
    ///
    /// No `--exec` equivalent and none needed: `limactl shell` takes the command directly, and an empty
    /// program is left out rather than passed as an empty argument.
    async fn run_scope_command(
        &self,
        host: &dyn HostContext,
        program: &str,
        args: &[String],
        settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult> {
        let instance = instance(host, Some(program))?;
        let command = scope_command(host, settings, &instance.name, program, args);
        Ok(host.run_host_command(&command).await)
    }

    /// LIMA mounts the host home into the VM at the same path, so a local path is already valid inside.
    async fn resolve_guest_path(&self, _host: &dyn HostContext, local_path: &str) -> String {
        local_path.to_string()
    }

    /// `limactl list`. macOS only, and answered before anything is spawned: Lima exists nowhere else,
    /// so running `limactl` on Linux would fail slowly and be reported as "no instances".
    async fn list_scopes(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<Vec<ControllerScope>> {
        if host.os_type() != OperatingSystem::Darwin {
            return Ok(Vec::new());
        }
        let command = HostCommand {
            launcher: controller_launcher(settings, host.controller()).to_string(),
            args: vec!["list".to_string()],
            ..HostCommand::default()
        };
        let outcome = host.run_host_command(&command).await;
        if !outcome.success() {
            return Ok(Vec::new());
        }
        Ok(lima_instances(&outcome.stdout)
            .into_iter()
            .map(ControllerScope::LimaInstance)
            .collect())
    }

    /// The instance the settings NAME, found among the ones this host offers.
    ///
    /// Not the first, unlike WSL's: the original refuses to guess here (it logs "Controller scope is
    /// not set" and answers nothing), and the difference is real — a Lima instance may be any VM the
    /// user runs, where a WSL distribution list is the app's own.
    async fn controller_default_scope(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<Option<ControllerScope>> {
        let named = named_scope(settings);
        if named.is_empty() {
            return Ok(None);
        }
        Ok(self
            .list_scopes(host, settings)
            .await?
            .into_iter()
            .find(|scope| instance_name(scope).is_some_and(|name| name == named)))
    }

    /// `limactl start <scope>` — unless the instance is already running, which is `Running` and not
    /// `Started`, because nothing here started it.
    async fn start_scope(&self, host: &dyn HostContext) -> UnitResult<StartupStatus> {
        let instance = instance(host, None)?.clone();
        if instance.usable == Some(true) {
            return Ok(StartupStatus::Running);
        }
        let settings = host.settings().await;
        let started = host
            .run_host_command(&instance_command(host, &settings, "start", &instance.name))
            .await;
        if started.success() {
            return Ok(StartupStatus::Started);
        }
        Ok(StartupStatus::Error)
    }

    /// The instance is left alone, exactly as the original leaves it: `stopLIMAInstance` answers `true`
    /// without running anything, because a VM another connection may be using is not this one's to stop.
    async fn stop_scope(&self, _host: &dyn HostContext) -> UnitResult<bool> {
        Ok(true)
    }

    /// The socket LIMA forwards for this instance, asked of LIMA itself.
    ///
    /// Empty when no instance is named, which is what the original's "getApiConnection requires a
    /// scope" guard produces one step later. The `<scope>.sock` fallback is right only for an instance
    /// named after its engine, so it is reached only when LIMA cannot be asked at all.
    async fn resolve_scope_uri(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
        socket: &str,
    ) -> String {
        let scope = named_scope(settings);
        if scope.is_empty() {
            return String::new();
        }
        let reported = ask_forwarded_socket(host, settings, scope, socket).await;
        if !reported.is_empty() {
            return reported;
        }
        let os = host.os_type();
        let directory = join(
            os,
            &join(os, &join(os, host.home(), LIMA_SOCKET_BASE), scope),
            LIMA_SOCKET_DIRECTORY,
        );
        join(os, &directory, &format!("{scope}.sock"))
    }

    /// `limactl start <scope>`, waited on until the socket the instance binds is there.
    ///
    /// Engine-agnostic: the dialect is not consulted, because starting the INSTANCE is the whole of
    /// what this transport can do about an API. A `false` is forgiven — the instance may already be up.
    async fn start_api(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<bool> {
        let instance = instance(host, None)?.clone();
        let address = settings.api.connection.uri.trim().to_string();
        if address.is_empty() {
            return Err(Diagnostic::new(DiagnosticCode::ApiSocketUnresolved));
        }
        let command = instance_command(host, settings, "start", &instance.name);
        let opts = ServiceOpts {
            retry: Retry {
                count: API_READINESS_ATTEMPTS,
                wait: API_READINESS_WAIT,
            },
            // The socket LIMA binds is under this machine's home directory, so a request down it
            // reaches the engine — as it does for a machine, and unlike a service inside a distribution.
            check_status: api_answers(&address, settings, host),
        };
        match host
            .command()
            .spawn_service(&api_service_id(host.id()), &command, &opts)
            .await
        {
            Ok(()) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    /// The service this attempt spawned goes; the INSTANCE is left running.
    ///
    /// The original runs `limactl stop <scope>` here, but only when the runner it is asking knows the
    /// API was started by THIS process — the flag that `runner.isStarted()` answers. This port has no
    /// such flag by design — a teardown addresses the connection by NAME, because a dropped
    /// future may never have recorded what it spawned — and the flag is what made the stop conditional.
    /// Stopping unconditionally would take a VM down that another connection is using; not stopping
    /// matches what `should_keep_started_scope_running` already says about this transport.
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

/// `limactl list --format json <scope>`, read for the socket it forwards.
///
/// Asked about ONE instance, so a name that is a prefix of another cannot read its forward. macOS
/// only, as [`Transport::list_scopes`] is.
async fn ask_forwarded_socket(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
    scope: &str,
    guest: &str,
) -> String {
    if host.os_type() != OperatingSystem::Darwin {
        return String::new();
    }
    let command = HostCommand {
        launcher: controller_launcher(settings, host.controller()).to_string(),
        args: vec![
            "list".to_string(),
            "--format".to_string(),
            "json".to_string(),
            scope.to_string(),
        ],
        ..HostCommand::default()
    };
    let outcome = host.run_host_command(&command).await;
    if !outcome.success() {
        return String::new();
    }
    forwarded_socket(&outcome.stdout, guest)
}

/// The instance this connection entered, or the reason it did not.
fn instance<'a>(
    host: &'a dyn HostContext,
    program: Option<&str>,
) -> Result<&'a LimaInstance, Diagnostic> {
    let kind = match host.scope() {
        Some(ControllerScope::LimaInstance(scope)) => return Ok(scope),
        Some(ControllerScope::PodmanMachine(_)) => ControllerScopeType::PodmanMachine,
        Some(ControllerScope::WslDistribution(_)) => ControllerScopeType::WslDistribution,
        Some(ControllerScope::SshHost(_)) => ControllerScopeType::SshConnection,
        None => {
            return Err(Diagnostic::with_params(
                DiagnosticCode::ScopeNotSet,
                serde_json::json!({ "transport": "lima", "program": program.unwrap_or_default() }),
            ));
        }
    };
    Err(Diagnostic::with_params(
        DiagnosticCode::ScopeNotSet,
        serde_json::json!({ "transport": "lima", "scope": kind.to_string() }),
    ))
}

/// This scope's name IF it is a Lima instance, and nothing for any other kind.
///
/// The transport-specific half of [`crate::runtimes::transports::shared::scope_name`], which answers
/// for every kind: selection matches a NAME the settings carry against the scopes a host offers, and
/// a name alone cannot say which kind it belongs to. So `None` here is not "unnamed" — it is "not
/// mine", and treating the two alike is how a Lima transport adopts a podman machine that happens to
/// share its name. `pub` for the same reason `scope_name` is: it is a rule, and a rule is pinned.
pub fn instance_name(scope: &ControllerScope) -> Option<&str> {
    match scope {
        ControllerScope::LimaInstance(instance) => Some(&instance.name),
        _ => None,
    }
}

/// `limactl shell <instance> <program> <args…>`.
fn scope_command(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
    instance: &str,
    program: &str,
    args: &[String],
) -> HostCommand {
    let mut argv = vec!["shell".to_string(), instance.to_string()];
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

/// `limactl start|stop <instance>`.
fn instance_command(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
    operation: &str,
    instance: &str,
) -> HostCommand {
    HostCommand {
        launcher: controller_launcher(settings, host.controller()).to_string(),
        args: vec![operation.to_string(), instance.to_string()],
        ..HostCommand::default()
    }
}
