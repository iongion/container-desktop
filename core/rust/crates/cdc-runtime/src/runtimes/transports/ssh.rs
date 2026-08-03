//! `runtimes/transports/ssh.ts` — the remote host, reached by shelling out to the system `ssh`.
//!
//! Every operation is an argv, because the user's access is defined by their environment —
//! `~/.ssh/config` aliases, agents, hardware keys, `ProxyJump`, `known_hosts` — and an embedded SSH
//! library reimplements a fraction of that and silently fails on the rest.
//!
//! What the inversion changed here is only the SHAPE: the argv rules and the verdict rules are the
//! same pure functions they were, in `domain/ssh/`. What is gone is the resumable planner that
//! existed so an executor could drive them — the sequence is now the sequence, written as one.

use std::time::Duration;

use async_trait::async_trait;

use crate::capabilities::command::{CommandExecutionResult, HostCommand, Retry, ServiceOpts};
use crate::domain::argv::{SSH_COMMAND_TIMEOUT, quote_scope_program};
use crate::domain::diagnostic::Diagnostic;
use crate::domain::ssh::args::SshCredentials;
use crate::domain::ssh::forward::{is_named_pipe, local_forward_address, windows_pipe_path};
use crate::domain::ssh::preflight::{PREFLIGHT_SENTINEL, SshPreflight};
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::diagnostic::DiagnosticCode;
use crate::domain::types::host::StartupStatus;
use crate::domain::types::machine::ControllerScope;
use crate::domain::types::os::{ControllerScopeType, OperatingSystem};
use crate::runtimes::composition::{HostContext, Transport, UnitResult};
use crate::runtimes::dialects::podman_machine_connections::{
    SYSTEM_CONNECTION_LIST_ARGS, parse_system_connections,
};
use crate::runtimes::dialects::podman_machine_ssh::{
    PodmanMachineSsh, dial_stdio_args, machine_ssh_connection,
};
use crate::runtimes::transports::native::api_service_id;
use crate::runtimes::transports::shared::api_answers;

/// What the connection probe echoes. `services.ts:SSHClient.connect` compares stdout to this exact
/// string, so it is specification rather than a message.
pub const SSH_PROBE_SENTINEL: &str = "SSH connection established";

/// `services.ts:startTunnel`'s `retry: { count: 5, wait: 2000 }`.
///
/// Deliberately NOT the engine API's ceiling, and the comment in `services.ts` says why: a remote
/// whose engine is not serving would otherwise be polled for the full 10 x 5s before failing, which
/// is the "forever" hang on boot. A healthy remote binds the socket on the first check, so the
/// shorter ceiling only ever shortens the dead-remote wait.
pub const TUNNEL_READINESS_ATTEMPTS: u32 = 5;

/// The wait between those attempts.
pub const TUNNEL_READINESS_WAIT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SshTransport;

#[async_trait]
impl Transport for SshTransport {
    fn is_scoped(&self) -> bool {
        true
    }

    /// The `ssh -NL` forward IS this connection's data plane, so it is opened on every attempt and
    /// not only when the engine's own service was asked for.
    fn opens_data_plane(&self) -> bool {
        true
    }

    /// `transports/ssh.ts:runScopeCommand`.
    ///
    /// The remote command's stdin is the local `ssh` process's stdin, which is how
    /// `login --password-stdin` reaches a remote engine without the secret ever appearing in remote
    /// argv — so a caller that sets [`HostCommand::input`] needs nothing else.
    async fn run_scope_command(
        &self,
        host: &dyn HostContext,
        program: &str,
        args: &[String],
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult> {
        let credentials = credentials(host, Some(program))?;
        let mut remote = vec![quote_scope_program(program)];
        remote.extend(args.iter().cloned());
        Ok(host
            .run_host_command(&ssh_command(&credentials, &remote))
            .await)
    }

    /// The remote filesystem is its own; a local path means nothing there, and the original returns
    /// it unchanged rather than guessing a mapping.
    async fn resolve_guest_path(&self, _host: &dyn HostContext, local_path: &str) -> String {
        local_path.to_string()
    }

    /// Enumerating SSH hosts means reading `~/.ssh/config`, which is the caller's to do — the same
    /// reason the resolved scope arrives as a value rather than a name.
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

    /// `services.ts:SSHClient.connect` — prove the host runs a command, then say what that means.
    ///
    /// `Running` rather than `Started`: `ssh` left nothing running, so what was found was already up.
    async fn start_scope(&self, host: &dyn HostContext) -> UnitResult<StartupStatus> {
        let credentials = credentials(host, None)?;
        let probe = ssh_command(
            &credentials,
            &["echo".to_string(), SSH_PROBE_SENTINEL.to_string()],
        );
        let outcome = host.run_host_command(&probe).await;
        // The host is reachable only if it ECHOED. A zero exit alone is not evidence: a shell that
        // prints a banner and exits 0 has not proved it can run the command the engine needs.
        if outcome.success() && outcome.stdout.trim() == SSH_PROBE_SENTINEL {
            return Ok(StartupStatus::Running);
        }
        // Why it failed is `diagnose_scope`'s answer. A code invented here would be a guess that the
        // preflight then contradicts.
        Ok(StartupStatus::Error)
    }

    /// `ssh` leaves nothing running, so there is no scope to stop.
    async fn stop_scope(&self, _host: &dyn HostContext) -> UnitResult<bool> {
        Ok(false)
    }

    /// Only Windows has an address to IMPOSE: the relay serves a named pipe, and a client cannot
    /// reach the engine any other way. POSIX has no opinion — the socket it would bind is a
    /// FALLBACK, and answering it here would overwrite a preset one.
    async fn resolve_scope_uri(
        &self,
        host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
        _socket: &str,
    ) -> String {
        if host.os_type() == OperatingSystem::WindowsNt {
            return windows_pipe_path(host.id());
        }
        String::new()
    }

    /// `resolveDialStdioBridge` — both arms, or EMPTY when the connection keeps its `ssh -NL` forward.
    ///
    /// A podman MACHINE keeps its socket inside a VM, so the forward has nothing on the remote HOST to
    /// point at and the bridge is a nested OpenSSH hop (`podman-machine-ssh.ts`). With no machine the
    /// engine bridges its own socket one hop away, which is the only way a Windows Docker remote is
    /// reached at all: its endpoint is a named pipe and [`Transport::start_api`] refuses one.
    ///
    /// No engine type is matched on. The machine listing's exit code answers "no machine here", and
    /// the dialect's `dial_stdio_program` answers whether this engine can be bridged — Apple cannot.
    /// `socket` is EVIDENCE for the plain arm and never an argument.
    ///
    /// **The dialect's target flags travel with the bridge**. Without them the remote's
    /// `<engine> system dial-stdio` dials whatever THAT machine's current context says, so a pinned
    /// connection would detect one engine and carry its data to another — the same drift the pin
    /// exists to stop, on the far side of the hop where nothing local would ever show it.
    async fn resolve_dial_stdio(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
        socket: &str,
    ) -> Vec<String> {
        // Both asked before the engine, so a refusal costs no round-trip.
        let Ok(credentials) = credentials(host, None) else {
            return Vec::new();
        };
        let Some(fallback) = host.dialect().dial_stdio_program() else {
            return Vec::new();
        };
        let remote = match machine_on(host, settings).await {
            Some(machine) => dial_stdio_args(&machine),
            None if !socket.is_empty() => {
                let mut bridge = vec![bridge_program(settings, fallback).to_string()];
                bridge.extend(host.dialect().target_args(settings));
                bridge.push("system".to_string());
                bridge.push("dial-stdio".to_string());
                bridge
            }
            None => return Vec::new(),
        };
        // The launcher is part of the argv: the consumer is the `Http` capability, which spawns what
        // it is given and knows nothing about transports.
        let mut argv = vec!["ssh".to_string()];
        argv.extend(credentials.args(&remote));
        argv
    }

    /// Derived rather than read: automatic detection leaves the API uri EMPTY for a remote host,
    /// because the engine socket is on the other machine. The local end of the tunnel is therefore
    /// computed from the connection itself when nothing supplied one.
    async fn local_forward_fallback(&self, host: &dyn HostContext) -> String {
        local_forward_address(host.os_type(), host.id(), host.user_data_path())
    }

    /// `services.ts:startTunnel` — the `ssh -NL` forward, held open for the connection's lifetime.
    ///
    /// **A `false`/`Err` here is NOT forgiven, unlike a native host's engine service.** Nothing else
    /// can have opened this forward, so a failure means the address the connection resolved names
    /// nothing, and carrying on would report `ready` on a socket with no listener.
    ///
    /// Both ends arrive already resolved and neither is recomputed: `imposed || preset || derived` is
    /// ranked in exactly one place, the profile.
    async fn start_api(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<bool> {
        // A bridge and a forward are two data planes for ONE engine, and the bridge outranks — which
        // is what `proxy::endpoint` already answers on the request side. Opening the forward anyway
        // would aim `ssh -NL` at a relay INSIDE a VM, a path the remote host does not have: the
        // forward fails, and the attempt fails with it, over a connection the bridge reaches.
        if !settings.api.connection.dial_stdio_command.is_empty() {
            return Ok(true);
        }
        let credentials = credentials(host, None)?;
        let local = settings.api.connection.uri.as_str();
        let remote = settings.api.connection.relay.as_str();
        if remote.is_empty() {
            // `-NL <local>:` forwards to nothing: the socket appears, readiness passes, and every
            // request through it fails separately. The original throws here for the same reason.
            return Err(forward_failed("relay", remote));
        }
        if is_named_pipe(local) {
            return Err(forward_failed("uri", local));
        }
        // And the same refusal for the FAR end, which is the case that actually occurs: a POSIX
        // client detecting a Windows remote reads `npipe:////./pipe/dockerDesktopLinuxEngine` as its
        // relay. Without this the forward is spawned, `ssh` rejects the specification, and the
        // attempt fails as a generic `API_UNREACHABLE` naming nothing. Verified live against win11.
        if is_named_pipe(remote) {
            return Err(forward_failed("relay", remote));
        }
        let command = HostCommand {
            launcher: "ssh".to_string(),
            args: credentials.tunnel_args(local, remote),
            // No timeout, unlike every other command here: the forward IS the connection, and
            // bounding it would be an instruction to kill the data plane mid-session.
            ..HostCommand::default()
        };
        let opts = ServiceOpts {
            retry: Retry {
                count: TUNNEL_READINESS_ATTEMPTS,
                wait: TUNNEL_READINESS_WAIT,
            },
            check_status: api_answers(local, settings, host),
        };
        host.command()
            .spawn_service(&api_service_id(host.id()), &command, &opts)
            .await
            .map_err(|error| {
                Diagnostic::with_params(
                    DiagnosticCode::SshForwardFailed,
                    serde_json::json!({
                        "transport": "ssh",
                        "uri": local,
                        "relay": remote,
                        "reason": error.to_string(),
                    }),
                )
            })?;
        Ok(true)
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

    /// `diagnostics/ssh-preflight.ts` — turn "not usable" into a cause.
    ///
    /// Asked only after `start_scope` already reached a bad verdict, so it never costs a healthy
    /// connection anything. The four checks stop at the FIRST thing actually wrong; `None` means
    /// everything checkable passed, which is a real answer and different from any code — inventing
    /// a cause there would be worse than the generic verdict the caller already has.
    async fn diagnose_scope(
        &self,
        host: &dyn HostContext,
        engine_program: Option<&str>,
    ) -> Option<Diagnostic> {
        let credentials = credentials(host, None).ok()?;
        let preflight = SshPreflight::new(credentials, host.os_type());

        // 1. Is there a runnable `ssh` at all?
        if !host
            .run_host_command(&preflight.version_command())
            .await
            .success()
        {
            return Some(Diagnostic::with_params(
                DiagnosticCode::ProgramNotFound,
                serde_json::json!({ "program": "ssh", "searched": [] }),
            ));
        }
        // 2. Can the identity file be read, and is it private enough for `ssh` to use? Skipped on
        //    Windows, which has ACLs rather than mode bits and no `stat -c` to ask.
        if let Some(command) = preflight.identity_command() {
            let outcome = host.run_host_command(&command).await;
            if let Some(fault) = preflight.identity_fault(&outcome) {
                return Some(fault);
            }
        }
        // 3. Does the host run a command?
        let reachable = host.run_host_command(&preflight.reachable_command()).await;
        if !SshPreflight::echoed(&reachable) {
            return Some(preflight.probe_fault(&reachable));
        }
        // 4. Is the engine on the far side actually there? Only when the caller wants that
        //    distinction — otherwise the link being good IS the whole answer.
        let program = engine_program?;
        let engine = host
            .run_host_command(&preflight.engine_command(program))
            .await;
        if engine.success() {
            return None;
        }
        Some(Diagnostic::with_params(
            DiagnosticCode::ProgramNotFound,
            // The host is named because that is what says the program is missing THERE rather than
            // on this machine — the same code without it would be read as a local failure.
            serde_json::json!({
                "program": program,
                "host": preflight.host(),
                "searched": [],
            }),
        ))
    }
}

/// The scope as SSH credentials, or the reason it is not usable.
///
/// `program` names what was being attempted when there is one, because "scope not set" on its own
/// does not say what will not run. The kind is taken from the SAME match that accepts an SSH host,
/// so there is no arm for "an SSH host that is not an SSH host", and it is reported as the schema's
/// own `ControllerScopeType` rather than a hand-written table of wire names that could drift.
fn credentials(
    host: &dyn HostContext,
    program: Option<&str>,
) -> Result<SshCredentials, Diagnostic> {
    let kind = match host.scope() {
        Some(ControllerScope::SshHost(scope)) => {
            return Ok(SshCredentials::from_scope(scope, host.home()));
        }
        Some(ControllerScope::PodmanMachine(_)) => ControllerScopeType::PodmanMachine,
        Some(ControllerScope::WslDistribution(_)) => ControllerScopeType::WslDistribution,
        Some(ControllerScope::LimaInstance(_)) => ControllerScopeType::LimaInstance,
        None => {
            return Err(Diagnostic::with_params(
                DiagnosticCode::ScopeNotSet,
                serde_json::json!({ "transport": "ssh", "program": program.unwrap_or_default() }),
            ));
        }
    };
    Err(Diagnostic::with_params(
        DiagnosticCode::ScopeNotSet,
        serde_json::json!({ "transport": "ssh", "scope": kind.to_string() }),
    ))
}

/// The machine `podman system connection list` named, if the remote is running one.
async fn machine_on(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
) -> Option<PodmanMachineSsh> {
    let args = SYSTEM_CONNECTION_LIST_ARGS.map(str::to_string);
    let outcome = host.run_engine_command(&args, settings).await.ok()?;
    if !outcome.success() {
        return None;
    }
    machine_ssh_connection(&parse_system_connections(&outcome.stdout))
}

/// `settings.program.name || "<engine>"`, never `program_launcher`: the detected path belongs to
/// whichever machine ran the lookup, and on a cmd.exe remote it is a quoted `C:\` path.
fn bridge_program<'a>(settings: &'a EngineConnectorSettings, fallback: &'a str) -> &'a str {
    if settings.program.name.is_empty() {
        return fallback;
    }
    &settings.program.name
}

/// A forward that cannot be opened, naming the SETTINGS FIELD that has to change.
fn forward_failed(field: &str, value: &str) -> Diagnostic {
    Diagnostic::with_params(
        DiagnosticCode::SshForwardFailed,
        serde_json::json!({ "transport": "ssh", field: value }),
    )
}

/// One `ssh` invocation, bounded so a command cannot outlive the connection attempt carrying it.
fn ssh_command(credentials: &SshCredentials, remote: &[String]) -> HostCommand {
    HostCommand {
        launcher: "ssh".to_string(),
        args: credentials.args(remote),
        timeout: Some(SSH_COMMAND_TIMEOUT),
        ..HostCommand::default()
    }
}

/// Re-exported for the preflight's own tests, which assert the sentinel is what the remote echoes.
pub const PREFLIGHT_ECHO: &str = PREFLIGHT_SENTINEL;
