//! `runtimes/transports/wsl.ts` — the engine runs inside a WSL distribution, which is the scope.
//!
//! Every operation is `wsl --distribution <scope> --exec …`. `--exec` rather than the guest's login
//! shell is the original's choice and it is load-bearing: a shell would apply the distribution's
//! profile, and the argv this port asserts would stop being the argv that ran.
//!
//! **What `start_api` opens here is the ENGINE's own service, not this connection's data plane**
//! — a WSL or LIMA scope is scoped AND runs the engine's own service inside the scope.
//! So [`Transport::opens_data_plane`] keeps its `false` default — the caller's `start_api` flag
//! decides whether it is asked at all — and a service that will not start is FORGIVEN, because the
//! engine inside the distribution may already be serving.
//!
//! Nothing here is verifiable from this machine: WSL exists only on Windows and no Windows client has
//! run this port. Written from the original, and said so out loud.

use async_trait::async_trait;

use crate::capabilities::command::{
    CommandExecutionResult, HostCommand, ReadinessCheck, Retry, ServiceOpts,
};
use crate::domain::diagnostic::Diagnostic;
use crate::domain::ssh::forward::windows_pipe_path;
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::diagnostic::DiagnosticCode;
use crate::domain::types::host::StartupStatus;
use crate::domain::types::machine::{ControllerScope, WslDistribution, WslDistributionType};
use crate::domain::types::os::{ControllerScopeType, OperatingSystem};
use crate::domain::wsl_args::{WslDialStdio, dial_stdio_args};
use crate::runtimes::composition::{HostContext, Transport, UnitResult};
use crate::runtimes::dialects::shared::normalize_unix_socket_path;
use crate::runtimes::transports::native::{
    API_READINESS_ATTEMPTS, API_READINESS_WAIT, api_service_id,
};
use crate::runtimes::transports::shared::{controller_launcher, named_scope, program_launcher};

/// What `startWSLDistribution` echoes to prove the distribution can run a program.
///
/// Compared against the tail of stdout exactly as the original compares it, so it is specification
/// rather than a message.
pub const WSL_PROBE_SENTINEL: &str = "started";

/// A distribution whose name begins with this belongs to a PODMAN MACHINE, and the relay pipe is
/// keyed by the machine rather than by the connection — `resolveScopeURI`.
///
/// Every connection naming that machine reaches the same engine, so a per-connection pipe would ask
/// the app to serve the same socket twice.
pub const PODMAN_MACHINE_SCOPE_PREFIX: &str = "podman-machine";

/// How many lines of `wsl -l -v` are the table HEADER.
///
/// Dropped by position because it is marked in no other way — no `--format json` exists for it, which
/// is the whole reason this listing is scraped at all.
pub const DISTRIBUTIONS_HEADER_LINES: usize = 1;

/// `shared.ts:getAvailableWSLDistributions` — read `wsl -l -v` through PowerShell.
///
/// `wsl.exe` writes UTF-16LE, which nothing in this port's pipes decodes: the exec capability answers
/// a `String`, and by the time a lossy conversion has happened the names are already gone. PowerShell
/// is what re-encodes it — the console encoding is switched, the lines are JSON-encoded, and the
/// switch is undone. The script is the original's, verbatim in shape.
pub fn distributions_script(wsl_path: &str) -> String {
    format!(
        "
      $console = ([console]::OutputEncoding)
      [console]::OutputEncoding = New-Object System.Text.UnicodeEncoding
      $distributions = ({wsl_path} -l -v) | ConvertTo-Json -Compress
      [console]::OutputEncoding = $console
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      [Console]::Write(\"$distributions\")
    "
    )
}

/// The distributions in what that script printed: a JSON array of the command's own lines.
///
/// Unparseable output is NO distributions, exactly as the original's `catch` leaves it — a listing
/// failure, not a crash. A line that names nothing is dropped, where the original keeps it and
/// produces a distribution whose every field is `undefined`: that reaches a picker as a blank row a
/// user can select, and selecting it configures a scope that does not exist.
pub fn wsl_distributions(stdout: &str) -> Vec<WslDistribution> {
    let Ok(lines) = serde_json::from_str::<Vec<String>>(stdout) else {
        return Vec::new();
    };
    lines
        .iter()
        .skip(DISTRIBUTIONS_HEADER_LINES)
        .filter_map(|line| distribution_from_line(line))
        .collect()
}

/// One `wsl -l -v` row: `* Ubuntu    Running   2`, the star marking the default.
fn distribution_from_line(line: &str) -> Option<WslDistribution> {
    let mut fields = line.split_whitespace();
    let first = fields.next()?;
    let default = first == "*";
    let name = if default { fields.next()? } else { first };
    let state = fields.next().unwrap_or_default();
    Some(WslDistribution {
        current: false,
        default,
        name: name.to_string(),
        state: state.to_string(),
        type_: WslDistributionType::WslDistribution,
        // `State === "Running"` — the only thing that makes a distribution usable, and absent state
        // is not running.
        usable: Some(state == "Running"),
        version: fields.next().unwrap_or_default().to_string(),
    })
}

/// `wsl.ts:windowsPathToWSLPath` — a local path as the distribution sees it.
///
/// The file pickers hand back Windows paths (`C:\Users\…`) and the engine runs inside the guest, where
/// those files are mounted under `/mnt/<drive>`. Anything already POSIX passes through: a path that is
/// not drive-lettered is either already the guest's or none of this port's business.
pub fn windows_path_to_wsl_path(local_path: &str) -> String {
    let mut characters = local_path.chars();
    let (Some(drive), Some(':')) = (characters.next(), characters.next()) else {
        return local_path.to_string();
    };
    if !drive.is_ascii_alphabetic() {
        return local_path.to_string();
    }
    let after_drive = &local_path[2..];
    // ONE separator, as the original's `[\\/]?` matches one: `C:\\double` keeps the second, which is
    // what the guest sees too.
    let rest = after_drive
        .strip_prefix('\\')
        .or_else(|| after_drive.strip_prefix('/'))
        .unwrap_or(after_drive)
        .replace('\\', "/");
    let drive = drive.to_ascii_lowercase();
    if rest.is_empty() {
        return format!("/mnt/{drive}");
    }
    format!("/mnt/{drive}/{rest}")
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WslTransport;

#[async_trait]
impl Transport for WslTransport {
    fn is_scoped(&self) -> bool {
        true
    }

    /// A distribution this app started is this app's to leave. The original answers `false` here and
    /// still declines to stop one in `stopApi`, because by then another user may be inside it — the
    /// two are not in conflict: this says whose it is, `stop_scope` says what is safe to do about it.
    fn should_keep_started_scope_running(&self) -> bool {
        false
    }

    /// `wsl --distribution <scope> --exec <program> <args…>`.
    async fn run_scope_command(
        &self,
        host: &dyn HostContext,
        program: &str,
        args: &[String],
        settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult> {
        let distribution = distribution(host, Some(program))?;
        let command = scope_command(host, settings, &distribution.name, program, args);
        Ok(host.run_host_command(&command).await)
    }

    async fn resolve_guest_path(&self, _host: &dyn HostContext, local_path: &str) -> String {
        windows_path_to_wsl_path(local_path)
    }

    /// The distributions this machine offers.
    ///
    /// Unlike SSH's, this listing genuinely needs the CONTROLLER — the design says so where it declines
    /// to port `listScopes`'s availability gate — so it belongs to the transport and not to a host
    /// crate. Off Windows there is nothing to ask: answering before spawning anything is what stops
    /// `powershell` being run on Linux and its failure being reported as "no distributions".
    async fn list_scopes(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<Vec<ControllerScope>> {
        if host.os_type() != OperatingSystem::WindowsNt {
            return Ok(Vec::new());
        }
        let script = distributions_script(controller_launcher(settings, host.controller()));
        let probe = HostCommand::new("powershell", &["-Command", &script]);
        let outcome = host.run_host_command(&probe).await;
        if !outcome.success() {
            return Ok(Vec::new());
        }
        Ok(wsl_distributions(&outcome.stdout)
            .into_iter()
            .map(ControllerScope::WslDistribution)
            .collect())
    }

    /// The FIRST distribution offered, which is what the original picks — not the one WSL marks as
    /// default. Reading the star instead would make the connection a picker creates disagree with the
    /// one automatic settings create.
    async fn controller_default_scope(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<Option<ControllerScope>> {
        Ok(self.list_scopes(host, settings).await?.into_iter().next())
    }

    /// `startWSLDistribution` — running something in a stopped distribution is what boots it.
    ///
    /// A distribution already `Running` is `Running`, not `Started`: nothing here started it, and the
    /// difference decides whether it is this app's to shut down. Otherwise `echo` is run, and it must
    /// have ECHOED — the same rule the SSH probe follows, for the same reason: a zero exit from a
    /// distribution that printed a banner has proved nothing about running the engine.
    async fn start_scope(&self, host: &dyn HostContext) -> UnitResult<StartupStatus> {
        let distribution = distribution(host, None)?;
        if distribution.usable == Some(true) {
            return Ok(StartupStatus::Running);
        }
        // `start_scope` carries no settings, so the launcher comes from the ones the machine is
        // holding for this attempt — which is what `runScopeCommand`'s own fallback reads.
        let settings = host.settings().await;
        let probe = scope_command(
            host,
            &settings,
            &distribution.name,
            "echo",
            &[WSL_PROBE_SENTINEL.to_string()],
        );
        let outcome = host.run_host_command(&probe).await;
        if outcome.success() && outcome.stdout.trim().ends_with(WSL_PROBE_SENTINEL) {
            return Ok(StartupStatus::Started);
        }
        Ok(StartupStatus::Error)
    }

    /// A distribution is shared: another connection — or another user — may be inside it, so it is
    /// deliberately left running. `true` is "the intended outcome was reached", which is what the
    /// original answers and not the same claim as "something was stopped".
    async fn stop_scope(&self, _host: &dyn HostContext) -> UnitResult<bool> {
        Ok(true)
    }

    /// The engine's socket is inside the guest, so a Windows client reaches it through the app's relay
    /// pipe — an address this transport IMPOSES, because nothing else is reachable.
    ///
    /// Keyed by the CONNECTION, except for a podman machine: its distribution is shared by every
    /// connection that names the machine, so the pipe is keyed by the machine instead.
    async fn resolve_scope_uri(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
        _socket: &str,
    ) -> String {
        let scope = named_scope(settings);
        if scope.starts_with(PODMAN_MACHINE_SCOPE_PREFIX) {
            return windows_pipe_path(scope);
        }
        windows_pipe_path(host.id())
    }

    /// The engine's OWN `system dial-stdio`, run inside the distribution — `wsl-args.ts`.
    ///
    /// This is what makes a WSL connection reachable at all from a native Windows client. The uri
    /// [`WslTransport::resolve_scope_uri`] imposes is a pipe that only answers if something binds it;
    /// this command reaches the engine with nothing bound, because the bytes travel over the child's
    /// stdin and stdout ([`crate::capabilities::http::Endpoint::Stdio`]).
    ///
    /// **The launcher is part of the argv**, unlike `scope_command`, which returns it separately: the
    /// consumer here is the `Http` capability, which spawns what it is given and knows nothing about
    /// controllers.
    ///
    /// Both refusals are the same rule — a bridge that cannot name what it is entering, or what it is
    /// pointing at, would silently reach the DEFAULT distribution or the DEFAULT socket, which is a
    /// different engine from the one this connection resolved.
    async fn resolve_dial_stdio(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
        socket: &str,
    ) -> Vec<String> {
        let socket_path = normalize_unix_socket_path(socket);
        let scope = named_scope(settings);
        if socket_path.is_empty() || scope.is_empty() {
            return Vec::new();
        }
        let mut argv = vec![controller_launcher(settings, host.controller()).to_string()];
        argv.extend(dial_stdio_args(&WslDialStdio {
            distribution: scope,
            program: program_launcher(settings),
            engine: host.dialect().engine(),
            socket_path: &socket_path,
        }));
        argv
    }

    /// `wsl.ts:startApi` — start the engine's own service INSIDE the distribution.
    ///
    /// The socket it binds is the RELAY, not the uri: the uri is the local pipe a client dials and the
    /// relay is what the engine listens on in the guest. Getting those the wrong way round would bind
    /// a Windows pipe path inside a Linux distribution.
    ///
    /// A `false` is forgiven by the caller, as a native host's is and unlike a forward's: something
    /// outside this app may already have started the engine in there, and the availability check is
    /// what decides.
    async fn start_api(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<bool> {
        let socket_path = normalize_unix_socket_path(&settings.api.connection.relay);
        let Some(service_args) = host
            .dialect()
            .build_service_args(&socket_path, host.log_level())
        else {
            // "Start api skipped - not required": Docker inside the distribution manages its own
            // service, so there is nothing to launch and that is not a failure.
            return Ok(true);
        };
        if socket_path.is_empty() {
            // `podman system service unix://` would bind nothing.
            return Err(Diagnostic::new(DiagnosticCode::ApiSocketUnresolved));
        }
        let distribution = distribution(host, None)?.clone();
        ensure_relay_directory(host, settings, &distribution.name, &socket_path).await;

        let command = scope_command(
            host,
            settings,
            &distribution.name,
            program_launcher(settings),
            &service_args,
        );
        let opts = ServiceOpts {
            retry: Retry {
                count: API_READINESS_ATTEMPTS,
                wait: API_READINESS_WAIT,
            },
            // The socket is the GUEST's, so no local path check can ever see it — the original polls
            // `GET /_ping` through the app's relay, which is the design's. What CAN be asked today is
            // the scope itself, and the transport is the only thing that knows how to enter one.
            check_status: ReadinessCheck::CommandSucceeds {
                command: scope_command(
                    host,
                    settings,
                    &distribution.name,
                    "test",
                    &["-S".to_string(), socket_path.clone()],
                ),
            },
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

/// The distribution this connection entered, or the reason it did not.
///
/// `program` names what was being attempted when there is one, because "scope not set" alone does not
/// say what will not run. A scope resolves by NAME, so what arrives can be a machine or a Lima
/// instance that happens to be called the same thing — each refused by KIND, reported as the schema's
/// own [`ControllerScopeType`] rather than a hand-written table of wire names that could drift.
fn distribution<'a>(
    host: &'a dyn HostContext,
    program: Option<&str>,
) -> Result<&'a WslDistribution, Diagnostic> {
    let kind = match host.scope() {
        Some(ControllerScope::WslDistribution(scope)) => return Ok(scope),
        Some(ControllerScope::PodmanMachine(_)) => ControllerScopeType::PodmanMachine,
        Some(ControllerScope::LimaInstance(_)) => ControllerScopeType::LimaInstance,
        Some(ControllerScope::SshHost(_)) => ControllerScopeType::SshConnection,
        None => {
            return Err(Diagnostic::with_params(
                DiagnosticCode::ScopeNotSet,
                serde_json::json!({ "transport": "wsl", "program": program.unwrap_or_default() }),
            ));
        }
    };
    Err(Diagnostic::with_params(
        DiagnosticCode::ScopeNotSet,
        serde_json::json!({ "transport": "wsl", "scope": kind.to_string() }),
    ))
}

/// One `wsl` invocation, with the program run through `--exec`.
///
/// Unbounded, unlike an `ssh` command: entering a distribution is local, and the ceiling `ssh` needs
/// is what a REMOTE costs. A program that is empty is left out entirely, as the original leaves it —
/// `wsl --distribution <s> --exec` with nothing to exec is a shell, and one argument of "" is not.
fn scope_command(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
    distribution: &str,
    program: &str,
    args: &[String],
) -> HostCommand {
    let mut argv = vec![
        "--distribution".to_string(),
        distribution.to_string(),
        "--exec".to_string(),
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

/// Create the directory the guest's socket will be bound in.
///
/// Podman does not create the base directory of the socket it is told to bind, and inside a
/// distribution that directory is the guest's — so the `mkdir` goes through the scope, not through
/// this machine's filesystem. A failure is a WARNING and nothing more, as the original leaves it: the
/// directory may already be there, and podman is what decides whether it can bind.
async fn ensure_relay_directory(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
    distribution: &str,
    socket_path: &str,
) {
    let Some(directory) = socket_path.rsplit_once('/').map(|(base, _)| base) else {
        return;
    };
    if directory.is_empty() {
        return;
    }
    let command = scope_command(
        host,
        settings,
        distribution,
        "mkdir",
        &["-p".to_string(), directory.to_string()],
    );
    let _ = host.run_host_command(&command).await;
}
