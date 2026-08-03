//! The exec port — the domain's only way to run anything.
//!
//! `host-contract/src/exec.ts` is a LEAF package below `container-client`, so the vocabulary of an
//! execution lives here and the domain imports it, never the reverse.
//!
//! Four operations, because that is what the transports actually need. `CreateNodeJSApiDriver` and
//! `ProxyRequest` from the TypeScript surface are not exec at all and become the `Http` capability
//!; `StartSSHConnection` is not a primitive either, but a composition of `run` and
//! `spawn_service` — modelling it as one operation is what hid that.
//!
//! What the original's shapes lose on the way in, all of it mechanics rather than domain:
//! a `pid: any` no decision reads, a `success` boolean stored beside the code it is derived from,
//! optional strings for streams that are empty rather than absent, milliseconds where a
//! [`Duration`] says the unit itself, and a `checkStatus` callback where data can be inspected.

use std::time::Duration;

use super::http::{Endpoint, HttpHeader};

use async_trait::async_trait;

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("could not spawn `{launcher}`: {source}")]
    Spawn {
        launcher: String,
        #[source]
        source: std::io::Error,
    },
    #[error("`{launcher}` did not finish within {}ms", timeout.as_millis())]
    Timeout { launcher: String, timeout: Duration },
    #[error("`{launcher}` never became ready after {count} attempts")]
    NotReady { launcher: String, count: u32 },
    #[error("no service is registered as {0:?}")]
    UnknownService(ServiceId),
    #[error("{operation} failed: {source}")]
    Io {
        operation: &'static str,
        #[source]
        source: std::io::Error,
    },
}

/// One command to run — the `launcher` + `command` of `ContainerEngineHostClientCommand`, carrying
/// the per-exec extras `HostExecOptions` threads alongside them in the original.
///
/// `input` is the only place a secret may travel: never argv, never a log line.
///
/// `ContainerEngineHostClientCommand.scope` is deliberately absent. Entering a scope is the
/// transport's job and it does it by WRAPPING the argv, so a scope reaching the exec port would be a
/// second place deciding how to enter one — free to disagree with the first.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HostCommand {
    /// `argv[0]`. `which` lives here, not in `args` — the easiest thing to get wrong.
    pub launcher: String,
    pub args: Vec<String>,
    pub input: Option<String>,
    pub timeout: Option<Duration>,
    pub cwd: Option<String>,
    /// Everything this process is given beyond what it inherits, the proxy variables included.
    ///
    /// **`HostExecOptions.proxyEnv` is NOT here, and it was a flag with no reader for as long as it
    /// was.** The original can carry a boolean because its exec layer reaches a process-global
    /// dictionary (`getEngineProxyEnv()`), set once from the GLOBAL settings; here the effective proxy
    /// is per connection (`domain::proxy::resolve_connection`), so a host would have to be told which
    /// connection it was spawning for. What travels instead is the variables themselves —
    /// [`crate::runtimes::composition::HostContext::engine_proxy_env`] decides them, and a host with
    /// no settings of its own can honour what it is handed.
    pub env: Vec<(String, String)>,
}

impl HostCommand {
    pub fn new(launcher: impl Into<String>, args: &[&str]) -> Self {
        Self {
            launcher: launcher.into(),
            args: args.iter().map(|it| (*it).to_string()).collect(),
            ..Default::default()
        }
    }

    /// The full argv. Assertions compare all of it, never its tail.
    pub fn argv(&self) -> Vec<&str> {
        let mut argv = Vec::with_capacity(self.args.len() + 1);
        argv.push(self.launcher.as_str());
        argv.extend(self.args.iter().map(String::as_str));
        argv
    }
}

/// What a command did — `CommandExecutionResult`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CommandExecutionResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl CommandExecutionResult {
    pub fn ok(stdout: impl Into<String>) -> Self {
        Self {
            code: 0,
            stdout: stdout.into(),
            stderr: String::new(),
        }
    }

    pub fn failed(code: i32, stderr: impl Into<String>) -> Self {
        Self {
            code,
            stdout: String::new(),
            stderr: stderr.into(),
        }
    }

    /// `CommandExecutionResult.success` — answered rather than stored, so it cannot contradict the
    /// code sitting next to it.
    pub fn success(&self) -> bool {
        self.code == 0
    }

    /// `result.stdout || result.stderr` — JavaScript's falsy-empty-string fallback, which the version
    /// parse depends on for engines that print to stderr.
    pub fn output(&self) -> &str {
        if self.stdout.is_empty() {
            &self.stderr
        } else {
            &self.stdout
        }
    }
}

/// What must become true for a spawned service to count as up — `ServiceOpts.checkStatus`, as data.
///
/// A value rather than the original's callback: the caller can see what "ready" means without
/// running it, a test can assert it, and the server can log it — none of which a closure
/// supports.
///
/// Two variants, each with a consumer that cannot use the other. `podman system service` and `ssh -NL`
/// are both ready when the ENGINE ANSWERS over what they opened on this machine; a service started
/// inside a scope binds its socket in the GUEST, where no local request can ever reach it — so what can
/// be asked there is the scope itself, and only the transport knows how to enter one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadinessCheck {
    /// The engine answers `GET /_ping` over the address this service opened — `isApiRunning`, which is
    /// the `checkStatus` both of the oracle's spawners poll (`runner.ts:startApi`,
    /// `services.ts:startTunnel`).
    ///
    /// **It asks the ENGINE, and the two weaker questions it replaced are the two defects this port has
    /// already paid for.** A FILE at the path proves nothing: neither `podman system service` nor
    /// `ssh -NL` unlinks its socket when killed (verified live for OpenSSH 10.2 under SIGTERM and
    /// SIGKILL, and for podman under the app's own teardown), so the corpse of the previous run
    /// satisfied a presence check in 0.3ms. A CONNECT tells a corpse from a server and still stops one
    /// question short: `ssh -NL` accepts locally and can have had its channel refused by the remote, and
    /// a `podman system service` binds its socket before it is serving. Both report `ready` over an
    /// address that then answers `API_UNREACHABLE` to the very next request.
    ///
    /// **What it buys is the WAIT.** The engine gets the spawner's whole retry budget to come up, which
    /// is what the oracle grants it; before this the port asked the real question once, in the
    /// availability sub-step immediately afterwards, and a connection whose engine was still starting
    /// failed on the first refusal.
    ///
    /// The headers travel with it because the daemon SELECTS on `Host`
    /// ([`crate::domain::machine::proxy::api_headers`]) — a probe that asked with a different one would
    /// not be asking the question the forwarded traffic asks afterwards.
    ApiAnswers {
        endpoint: Endpoint,
        headers: Vec<HttpHeader>,
    },
    /// A command that exits 0 — built by the transport, because a scope reaching the exec port would
    /// be a second place deciding how to enter one, free to disagree with the first.
    CommandSucceeds { command: HostCommand },
}

/// `ServiceOpts.retry` — the bounded poll a long-lived process is waited on with, so a UI can say
/// "retry 2 of 5" exactly as `onStatusCheck` does today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Retry {
    pub count: u32,
    pub wait: Duration,
}

/// How to start something and know it is up — `ServiceOpts` (`types/host.ts`).
///
/// The original's `onSpawn` / `onStatusCheck` hooks are absent until something subscribes: progress
/// is the connection machine's to emit, and a capability that also reported it would be a second
/// source for the same line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceOpts {
    pub retry: Retry,
    pub check_status: ReadinessCheck,
}

/// Which spawned service a caller means.
///
/// A name rather than the original's `SpawnedProcess` handle, because today's caller is the pure
/// connection machine, which cannot own a child. Once the units perform their own I/O one of them
/// holds the handle instead and this is replaced by it — with `kill` becoming `Drop` and `unref`,
/// which is a libuv concept, becoming nothing.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ServiceId(pub String);

/// Which stream a chunk arrived on. Streaming builds and log follows need to keep them apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StdioSource {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub source: StdioSource,
    pub data: String,
}

/// A running command's output, until it exits.
#[async_trait]
pub trait StreamHandle: Send {
    /// The next chunk, or `None` once the process has exited and its pipes are drained.
    async fn next_chunk(&mut self) -> Option<Chunk>;

    /// Wait for exit. Draining first is the caller's job — a process whose pipe fills while nobody
    /// reads it blocks forever.
    async fn wait(&mut self) -> Result<CommandExecutionResult, CommandError>;
}

#[async_trait]
pub trait Command: Send + Sync {
    /// Execute to completion. `command.input` is written and the pipe closed; it must never appear in
    /// argv or in a log line.
    async fn run(&self, command: &HostCommand) -> Result<CommandExecutionResult, CommandError>;

    /// Execute and yield chunks until exit. No timeout, by design — a build takes as long as it
    /// takes.
    async fn stream(&self, command: &HostCommand) -> Result<Box<dyn StreamHandle>, CommandError>;

    /// Start a long-lived process and poll `opts.check_status` on its retry schedule until it is
    /// ready.
    ///
    /// The handle is held by the capability for the connection's lifetime. Dropping it must terminate
    /// the process: an orphaned `ssh -NL` outliving its connection is the failure mode
    /// calls out by name.
    async fn spawn_service(
        &self,
        id: &ServiceId,
        command: &HostCommand,
        opts: &ServiceOpts,
    ) -> Result<(), CommandError>;

    /// Terminate a service started by `spawn_service`.
    async fn kill(&self, id: &ServiceId) -> Result<(), CommandError>;
}
