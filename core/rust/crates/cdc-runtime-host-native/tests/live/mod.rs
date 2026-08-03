//! The live rig: which machine to talk to, and the capability that talks to it.
//!
//! A module rather than more of `live_ssh.rs`, which is at its line ceiling. The split is along the
//! seam the suite actually has — everything here answers "WHERE do I run", and the tests above answer
//! "what must be true when I do".

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cdc_runtime::capabilities::command::{
    Command, CommandError, CommandExecutionResult, HostCommand, ServiceId, ServiceOpts,
    StreamHandle,
};
use cdc_runtime::domain::diagnostic::Diagnostic;
use cdc_runtime::domain::machine::{ConnectionCapabilities, ConnectionContext, ConnectionMachine};
use cdc_runtime::domain::types::connection::{ConnectOptions, Connection, SshHost, SshHostType};
use cdc_runtime::domain::types::engine::{ContainerEngine, ContainerEngineHost};
use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::host_client::{HostClient, HostClientComposition, HostEnvironment};
use cdc_runtime::runtimes::registry::compose;
use cdc_runtime_host_native::command::TokioCommand;
use cdc_runtime_host_native::fs::{StdFs, SystemClock};
use cdc_runtime_host_native::http::TokioHttp;
use cdc_runtime_host_native::paths::home_variable;
use cdc_runtime_host_native::ssh_config::list_scopes;
use serde_json::json;

/// The registry the TypeScript live suite already uses: `CDT_TARGET_<ID>_<FIELD>` in a gitignored
/// `src/__tests__/live/targets.env`, beside a committed `targets.example.env`. READ rather than
/// duplicated — a machine is declared once, in the place the owner already fills in, and this suite is
/// a second reader of it rather than a second convention.
const TARGETS_ENV: &str = "../../../../src/__tests__/live/targets.env";
/// Narrow to one target id (comma-separated), exactly as `yarn test:live` does.
const SELECT_VAR: &str = "CONTAINER_DESKTOP_TEST_TARGETS";
/// Overrides, and they WIN over the file — a `~/.ssh/config` alias or a bare hostname.
const SCOPE_VAR: &str = "CDC_LIVE_SSH_SCOPE";
const WINDOWS_SCOPE_VAR: &str = "CDC_LIVE_SSH_WINDOWS_SCOPE";
/// Which engine the remote runs; otherwise taken from the target's `_HOSTS`. Its dialect decides how
/// the socket is discovered.
const ENGINE_VAR: &str = "CDC_LIVE_SSH_ENGINE";

/// Both conventions that file carries, because both declare an SSH remote and the owner fills in
/// whichever fits: `CDT_TARGET_<ID>_*` is the live matrix's registry (`targets.ts`), and
/// `CONTAINER_DESKTOP_REMOTE_<ID>_*` is what `support/ssh-remote-sandbox.sh` writes for its disposable
/// sshd+dockerd container (`remote-env.ts`). The second has no `_OS` or `_ENABLED` — an entry with an
/// `_SSH_HOST` IS the declaration, and it is POSIX.
const PREFIXES: [&str; 2] = ["CDT_TARGET_", "CONTAINER_DESKTOP_REMOTE_"];

/// The fields this suite reads, longest first so `SSH_HOST` wins over `HOSTS` — the same ordering rule
/// and the same reason as `targets.ts:FIELD_SUFFIXES`.
const FIELDS: [&str; 8] = [
    "SSH_HOST", "SSH_PORT", "SSH_USER", "SSH_KEY", "ENABLED", "ENGINE", "HOSTS", "OS",
];

pub fn home() -> String {
    std::env::var(home_variable(std::env::consts::OS)).expect("a home directory")
}

/// One machine as `targets.env` declares it. Only the SSH-relevant fields; sockets, WSL and Lima
/// belong to the TypeScript suite's own concerns.
#[derive(Debug, Default)]
pub struct Target {
    pub id: String,
    pub enabled: bool,
    pub os: String,
    pub hosts: String,
    pub engine: String,
    pub ssh_host: String,
    pub ssh_port: Option<i64>,
    pub ssh_user: String,
    pub ssh_key: String,
}

impl Target {
    fn is_windows(&self) -> bool {
        self.os == "Windows_NT"
    }

    /// The engine to detect: an explicit override, else what the target declared — `_ENGINE` directly,
    /// or the first `*.remote` entry of `_HOSTS` — else Docker.
    pub fn engine(&self) -> String {
        if let Ok(engine) = std::env::var(ENGINE_VAR) {
            return engine;
        }
        if !self.engine.is_empty() {
            return self.engine.clone();
        }
        self.hosts
            .split(',')
            .map(str::trim)
            .find_map(|host| host.strip_suffix(".remote"))
            .unwrap_or("docker")
            .to_string()
    }
}

/// Where `targets.env` actually is.
///
/// It is GITIGNORED, and this core is developed in a git worktree — so the file the owner fills in
/// lives in the MAIN checkout and does not exist beside this one. The main working tree is the parent of
/// `git rev-parse --git-common-dir`, which is the one thing that points there from inside a worktree.
fn targets_env_path() -> Option<PathBuf> {
    let here = Path::new(env!("CARGO_MANIFEST_DIR")).join(TARGETS_ENV);
    if here.is_file() {
        return Some(here);
    }
    let common = std::process::Command::new("git")
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .ok()?;
    let main = Path::new(String::from_utf8_lossy(&common.stdout).trim())
        .parent()?
        .join("src/__tests__/live/targets.env");
    main.is_file().then_some(main)
}

/// `targets.env`, parsed into targets. An absent file is no targets rather than an error: the
/// `CDC_LIVE_*` overrides are a complete way to run this suite on a machine that has no registry.
fn declared_targets() -> Vec<Target> {
    let Some(contents) = targets_env_path().and_then(|path| std::fs::read_to_string(path).ok())
    else {
        return Vec::new();
    };
    let mut targets: Vec<Target> = Vec::new();
    for line in contents.lines().map(str::trim) {
        let Some((which, rest)) = PREFIXES
            .iter()
            .enumerate()
            .find_map(|(which, prefix)| line.strip_prefix(prefix).map(|rest| (which, rest)))
        else {
            continue;
        };
        let Some((key, value)) = rest.split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches('"');
        let Some(field) = FIELDS
            .iter()
            .find(|field| key.ends_with(&format!("_{field}")) && key.len() > field.len() + 1)
        else {
            continue;
        };
        let id = key[..key.len() - field.len() - 1].to_lowercase();
        let target = match targets.iter_mut().find(|target| target.id == id) {
            Some(target) => target,
            None => {
                targets.push(Target {
                    id,
                    // `CONTAINER_DESKTOP_REMOTE_*` has no `_ENABLED` field: declaring an `_SSH_HOST` IS
                    // the declaration (`remote-env.ts` is "lenient" for exactly that reason), where a
                    // registry entry must opt in explicitly — `targets.ts` reads a missing one as false.
                    enabled: which == 1,
                    ..Target::default()
                });
                targets.last_mut().expect("just pushed")
            }
        };
        match *field {
            "SSH_HOST" => target.ssh_host = value.to_string(),
            "SSH_PORT" => target.ssh_port = value.parse().ok(),
            "SSH_USER" => target.ssh_user = value.to_string(),
            "SSH_KEY" => target.ssh_key = value.to_string(),
            "ENABLED" => target.enabled = value == "true",
            "ENGINE" => target.engine = value.to_string(),
            "HOSTS" => target.hosts = value.to_string(),
            _ => target.os = value.to_string(),
        }
    }
    targets
}

/// The target to exercise: the `CDC_LIVE_*` override if there is one, else the first ENABLED target in
/// `targets.env` with an SSH endpoint and the right OS.
pub fn target(windows: bool) -> Target {
    let override_var = if windows {
        WINDOWS_SCOPE_VAR
    } else {
        SCOPE_VAR
    };
    if let Ok(host) = std::env::var(override_var) {
        return Target {
            id: format!("${override_var}"),
            enabled: true,
            os: if windows { "Windows_NT" } else { "Linux" }.to_string(),
            ssh_host: host,
            ..Target::default()
        };
    }
    let selected = std::env::var(SELECT_VAR).unwrap_or_default();
    declared_targets()
        .into_iter()
        .find(|target| {
            target.enabled
                && !target.ssh_host.is_empty()
                && target.is_windows() == windows
                && (selected.is_empty()
                    || selected.split(',').map(str::trim).any(|id| id == target.id))
        })
        .unwrap_or_else(|| {
            panic!(
                "no live target: set {override_var}=<alias|host>, or enable one in \
                 src/__tests__/live/targets.env with _SSH_HOST and _OS{}",
                if windows {
                    "=Windows_NT"
                } else {
                    " not Windows_NT"
                }
            )
        })
}

/// The target as a scope.
///
/// When `_SSH_HOST` names a `~/.ssh/config` alias it is READ FROM THERE by the real parser, which is
/// what makes `config_host` — and the `-i`/`-p` suppression it implies — part of what the live run
/// covers. A bare hostname is built into a scope directly, and the tests say which shape they got
/// rather than quietly asserting less.
pub fn scope_of(target: &Target) -> SshHost {
    let declared = list_scopes(&StdFs, Path::new(&home())).expect("~/.ssh/config is readable");
    if let Some(alias) = declared
        .into_iter()
        .find(|host| host.name == target.ssh_host)
    {
        return alias;
    }
    bare_scope(
        &target.ssh_host,
        target.ssh_port.unwrap_or(22),
        &target.ssh_user,
    )
    .with_identity(&target.ssh_key)
}

/// The POSIX target's scope — what most of this suite is about.
pub fn scope() -> SshHost {
    scope_of(&target(false))
}

/// A scope pointing wherever a test needs, with no identity file — the preflight's key check is
/// skipped, so what is exercised is the classification of what `ssh` itself says.
pub fn bare_scope(host_name: &str, port: i64, user: &str) -> SshHost {
    SshHost {
        name: host_name.to_string(),
        type_: SshHostType::SshConnection,
        host: host_name.to_string(),
        host_name: host_name.to_string(),
        port,
        user: user.to_string(),
        identity_file: String::new(),
        config_host: None,
        connected: None,
        usable: None,
    }
}

/// A builder rather than a tenth positional argument: `identity_file` is one of five strings on
/// `SshHost` and a caller that swapped two would connect somewhere plausible and wrong.
trait WithIdentity {
    fn with_identity(self, identity_file: &str) -> Self;
}

impl WithIdentity for SshHost {
    fn with_identity(mut self, identity_file: &str) -> Self {
        self.identity_file = identity_file.to_string();
        self
    }
}

/// The real capability, with the two things a live test needs that a hermetic one gets for free.
///
/// The units perform their own I/O now, so a test can no longer inspect a step before it runs or edit
/// it on the way past. Both are done HERE instead: `argv` records what actually went to the host, and
/// `extra` is appended to the `ssh` invocations that CONNECT. Only one test needs the second, and only
/// to redirect `known_hosts` — `ssh` resolves `~` through the passwd database and NOT through `$HOME`
/// (verified: a sandboxed `HOME` is silently ignored), so pointing at a `known_hosts` of the test's own
/// is the only way to provoke a key mismatch without editing the runner's real one.
#[derive(Default)]
pub struct Live {
    inner: TokioCommand,
    extra: Vec<String>,
    argv: Mutex<Vec<Vec<String>>>,
}

impl Live {
    pub fn with_extra(extra: &[String]) -> Self {
        Self {
            extra: extra.to_vec(),
            ..Self::default()
        }
    }

    /// `--` separates the local options from the remote command, so its presence is what says this
    /// invocation actually dials a host. `ssh -V` has none and must not be given options it would
    /// reject.
    fn resolved(&self, command: &HostCommand) -> HostCommand {
        if self.extra.is_empty() || !command.args.iter().any(|arg| arg == "--") {
            return command.clone();
        }
        let mut resolved = command.clone();
        resolved.args.splice(0..0, self.extra.iter().cloned());
        resolved
    }

    pub fn recorded(&self) -> Vec<Vec<String>> {
        self.argv.lock().expect("argv").clone()
    }
}

#[async_trait]
impl Command for Live {
    async fn run(&self, command: &HostCommand) -> Result<CommandExecutionResult, CommandError> {
        let resolved = self.resolved(command);
        self.argv
            .lock()
            .expect("argv")
            .push(resolved.argv().iter().map(|it| (*it).to_string()).collect());
        self.inner.run(&resolved).await
    }

    async fn stream(&self, command: &HostCommand) -> Result<Box<dyn StreamHandle>, CommandError> {
        self.inner.stream(command).await
    }

    async fn spawn_service(
        &self,
        id: &ServiceId,
        command: &HostCommand,
        opts: &ServiceOpts,
    ) -> Result<(), CommandError> {
        self.argv
            .lock()
            .expect("argv")
            .push(command.argv().iter().map(|it| (*it).to_string()).collect());
        self.inner.spawn_service(id, command, opts).await
    }

    async fn kill(&self, id: &ServiceId) -> Result<(), CommandError> {
        self.inner.kill(id).await
    }
}

/// Run one command here, on this machine.
pub async fn run(spec: &HostCommand) -> CommandExecutionResult {
    // A capability error becomes a failed outcome exactly as `run_host_command` makes it one, because
    // that is what the units under test are handed in production.
    TokioCommand::default()
        .run(spec)
        .await
        .unwrap_or_else(|error| CommandExecutionResult {
            code: -1,
            stdout: String::new(),
            stderr: error.to_string(),
        })
}

/// One parameter of a diagnostic. `Diagnostic` carries them as an optional `Value`, so every
/// assertion would otherwise spell the same two-step unwrap.
pub fn param<'a>(diagnostic: &'a Diagnostic, key: &str) -> Option<&'a serde_json::Value> {
    diagnostic
        .params
        .as_ref()
        .and_then(|params| params.get(key))
}

/// A remote connection whose controller names this scope, with detection left to run for real.
pub fn remote_connection(engine: &str, scope_name: &str) -> Connection {
    serde_json::from_value(json!({
      "id": format!("host.live.{engine}.remote"),
      "name": "live",
      "label": "Live",
      "engine": engine,
      "host": format!("{engine}.remote"),
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": "", "relay": "" } },
        "program": { "name": engine, "path": "", "version": "" },
        "controller": { "name": "ssh", "path": "", "version": "", "scope": scope_name },
        "rootfull": false,
        "mode": "mode.automatic"
      }
    }))
    .expect("connection fixture parses")
}

/// A real [`HostClient`] over the real capability, bound to `scope`.
///
/// The composition the registry resolves, not a hand-built one: what a live run has to prove is that
/// the units the app would actually compose reach a real host.
pub fn live_host(engine: ContainerEngine, scope: SshHost, command: Arc<Live>) -> HostClient {
    let host = match engine {
        ContainerEngine::Docker => ContainerEngineHost::DockerRemote,
        _ => ContainerEngineHost::PodmanRemote,
    };
    let units = compose(engine, host).expect("both remote connectors are implemented");
    let settings = remote_connection(&engine.to_string(), &scope.name).settings;
    HostClient::new(
        format!("host.live.{host}"),
        HostClientComposition {
            transport: units.transport,
            dialect: units.dialect,
            profile: units.profile,
            program: units.program,
            controller: units.controller,
        },
        HostEnvironment {
            is_flatpak: false,
            // This crate's own version, because a LIVE suite talks to a real engine and the
            // `User-Agent` it leaves in that engine's log should name something that exists.
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            os_type: OperatingSystem::Linux,
            // The real machine this suite runs on. `std::env::consts::ARCH` is `x86_64` where node's
            // `process.arch` is `x64`; only Apple's gate compares the value and this suite has no
            // Apple connector, so the honest raw name beats a translation nothing here exercises.
            arch: std::env::consts::ARCH.to_string(),
            home: home(),
            user_data_path: home(),
            log_level: "warn".to_string(),
            // A live target has whatever proxy the machine running the suite has, which is none: the
            // point of these is to reach a real engine, not to configure one.
            proxy: cdc_runtime::domain::proxy::normalize(None),
        },
        settings,
        command,
        Arc::new(StdFs),
        Arc::new(TokioHttp),
    )
    .with_scope(Some(ControllerScope::SshHost(scope)))
}

/// A machine for a live remote. The scope's own NAME is what the settings point at, which is how a
/// scope resolves by name in production — an alias when the target names one, the host otherwise.
pub fn live_machine(engine: &str, scope: SshHost, user_data_path: &str) -> ConnectionMachine {
    let name = scope.name.clone();
    ConnectionMachine::new(
        ConnectOptions {
            connection: remote_connection(engine, &name),
            start_api: false,
            skip_availability_check: false,
            origin: None,
        },
        ConnectionContext {
            os: OperatingSystem::Linux,
            home: home(),
            user_data_path: user_data_path.to_string(),
            scopes: vec![ControllerScope::SshHost(scope)],
            ..ConnectionContext::default()
        },
        ConnectionCapabilities {
            command: Arc::new(TokioCommand::default()),
            fs: Arc::new(StdFs),
            http: Arc::new(TokioHttp),
            clock: Arc::new(SystemClock),
        },
    )
}

/// A user data path short enough to hold a forward socket.
///
/// Not cosmetic: a unix socket path is capped near 104 bytes and `ssh` answers "Bad local forwarding
/// specification" for a longer one — which is why `local_forward_address` hashes the connection id in
/// the first place, and what a `target/` or `$TMPDIR` path would have hit here.
pub fn short_user_data() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("cdc-live-")
        .tempdir_in("/tmp")
        .expect("a short user data path")
}

/// How many `ssh` processes are forwarding to this address, according to `ps`.
///
/// The exit criterion is "checked with `ps`, not assumed", so the count comes from the process table
/// rather than from the capability's own bookkeeping — it believing it killed something is exactly
/// what is under test.
/// `ssh` children still holding a stdio bridge open. Each request spawns one and drops it, so a
/// count above zero once the attempt is over is the leak `ChildStdio`'s `kill_on_drop` prevents.
pub fn bridges_running() -> usize {
    let output = std::process::Command::new("ps")
        .args(["-eo", "args="])
        .output()
        .expect("ps runs");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| line.contains("system dial-stdio"))
        .count()
}

pub fn forwards_running(local_address: &str) -> usize {
    let output = std::process::Command::new("ps")
        .args(["-eo", "args="])
        .output()
        .expect("ps runs");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| line.contains("-NL") && line.contains(local_address))
        .count()
}
