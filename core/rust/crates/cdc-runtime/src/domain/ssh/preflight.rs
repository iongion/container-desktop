//! Why an SSH connection probe failed, as a diagnostic code.
//!
//! Ported from `diagnostics/ssh-preflight.ts`, which exists because a remote connection used to either
//! hang forever or fail with no reason. It runs a short ORDERED sequence and stops at the first thing
//! actually wrong, so the reason a user is given is a cause rather than the last symptom.
//!
//! **Bounded is the whole point.** Every step carries a timeout: a diagnostic that hangs is worse than
//! the hang it was written to explain.
//!
//! Two departures from the oracle, both deliberate:
//!
//! - **The verdict is one `Diagnostic`, not a five-step report.** `SSHPreflightReport` carries English
//!   per step for a UI to render, and the design keeps prose out of the domain. What the machine needs is
//!   the code that replaces `SCOPE_NOT_USABLE`; a client that wants to show the sequence can watch the
//!   commands go past, because they are ordinary host commands.
//! - **One `stat` covers the oracle's `key-file` AND `key-perms` steps.** It used `FS.isFilePresent` and
//!   then `stat`; a planner performs no I/O, and `stat` already fails when the file is not there. One
//!   round trip, the same two answers.

use std::time::Duration;

use crate::capabilities::command::{CommandExecutionResult, HostCommand};
use crate::domain::argv::SSH_COMMAND_TIMEOUT;
use crate::domain::diagnostic::Diagnostic;
use crate::domain::ssh::args::SshCredentials;
use crate::domain::types::diagnostic::DiagnosticCode;
use crate::domain::types::os::OperatingSystem;

/// What the remote is asked to echo. `diagnostics/ssh-preflight.ts:PREFLIGHT_SENTINEL`, verbatim —
/// deliberately not the connect probe's sentinel, because these are two different questions and a
/// caller reading the argv has to be able to tell which one it is looking at.
pub const PREFLIGHT_SENTINEL: &str = "container-desktop-ssh-preflight-ok";

/// The bound on the two LOCAL checks — `ssh -V` and `stat`.
///
/// Much shorter than [`SSH_COMMAND_TIMEOUT`], and not the same question: nothing here crosses a
/// network, so a local command that has not answered in five seconds is broken rather than slow.
pub const SSH_VERSION_TIMEOUT: Duration = Duration::from_secs(5);

/// The four checks, as pure rules plus the commands that feed them.
///
/// The SEQUENCE lives in `runtimes/transports/ssh.rs`, where it can simply be written down. What is
/// here is everything that can be decided without running anything — which is what a test can pin.
/// The ORDER is specification: each check is only worth asking once the previous has passed, and
/// asking them out of order reports a symptom as a cause.
///
/// `Eq` is deliberately absent: a `Diagnostic`'s params are a `serde_json::Value`, which is not `Eq`.
#[derive(Debug, Clone, PartialEq)]
pub struct SshPreflight {
    credentials: SshCredentials,
    /// Whether the identity file can be inspected here. Windows has ACLs rather than mode bits and no
    /// `stat -c` to ask, so the check is skipped exactly where the original skips it.
    check_identity: bool,
}

impl SshPreflight {
    pub fn new(credentials: SshCredentials, os: OperatingSystem) -> Self {
        Self {
            // No identity file is VALID and common — OpenSSH falls back to `ssh_config` defaults, the
            // agent and standard identity discovery, exactly as an interactive terminal does.
            check_identity: credentials.private_key_path.is_some()
                && os != OperatingSystem::WindowsNt,
            credentials,
        }
    }

    /// `ssh -V`, bounded short: a broken client must not cost a connect timeout to discover.
    pub fn version_command(&self) -> HostCommand {
        HostCommand {
            launcher: "ssh".to_string(),
            args: vec!["-V".to_string()],
            timeout: Some(SSH_VERSION_TIMEOUT),
            ..HostCommand::default()
        }
    }

    /// `stat -c %a <identity>`, or `None` where the check does not apply — no identity file
    /// configured, or a Windows client whose ACLs this cannot read.
    pub fn identity_command(&self) -> Option<HostCommand> {
        if !self.check_identity {
            return None;
        }
        Some(HostCommand {
            launcher: "stat".to_string(),
            args: vec![
                "-c".to_string(),
                "%a".to_string(),
                self.identity_file().to_string(),
            ],
            timeout: Some(SSH_VERSION_TIMEOUT),
            ..HostCommand::default()
        })
    }

    /// The reachability probe and the engine probe are the same shape — one `ssh` invocation bounded so
    /// it cannot outlive the attempt carrying it — so they are built in one place.
    fn remote_command(&self, command: &[String]) -> HostCommand {
        HostCommand {
            launcher: "ssh".to_string(),
            args: self.credentials.args(command),
            timeout: Some(SSH_COMMAND_TIMEOUT),
            ..HostCommand::default()
        }
    }

    pub fn reachable_command(&self) -> HostCommand {
        self.remote_command(&["echo".to_string(), PREFLIGHT_SENTINEL.to_string()])
    }

    pub fn engine_command(&self, program: &str) -> HostCommand {
        self.remote_command(&[program.to_string(), "info".to_string()])
    }

    pub fn identity_file(&self) -> &str {
        self.credentials
            .private_key_path
            .as_deref()
            .unwrap_or_default()
    }

    pub fn host(&self) -> &str {
        &self.credentials.host
    }

    pub fn user(&self) -> &str {
        self.credentials.username.as_deref().unwrap_or_default()
    }

    /// An identity file `ssh` will refuse to use, or `None` when it is fine.
    ///
    /// Both answers are `SSH_AUTH_FAILED` because both end the same way — `ssh` authenticating without
    /// the key the user configured — and the PARAMS say which it was. That is the same one-code /
    /// different-params shape `SSH_FORWARD_FAILED` uses for `relay` versus `uri`.
    pub fn identity_fault(&self, outcome: &CommandExecutionResult) -> Option<Diagnostic> {
        if !outcome.success() {
            return Some(Diagnostic::with_params(
                DiagnosticCode::SshAuthFailed,
                serde_json::json!({
                    "host": self.host(),
                    "user": self.user(),
                    "identity_file": self.identity_file(),
                }),
            ));
        }
        let mode = outcome.stdout.trim();
        // `ssh` silently IGNORES a key any other user can read, so the failure it would otherwise
        // produce is an unexplained "permission denied". Only the last two octal digits matter — the
        // group's and everyone else's — and the owner's bits are their own business.
        //
        // A suffix test rather than the oracle's `slice(-2)` plus a length guard: identical on every
        // mode `stat` can print, including the single digit it prints for mode 0 (which is correctly a
        // fault, since a key its owner cannot read is a key `ssh` cannot use), and with no arithmetic to
        // get wrong.
        if mode.ends_with("00") {
            return None;
        }
        Some(Diagnostic::with_params(
            DiagnosticCode::SshAuthFailed,
            serde_json::json!({
                "host": self.host(),
                "user": self.user(),
                "identity_file": self.identity_file(),
                "mode": mode,
            }),
        ))
    }

    /// Why the probe failed, from what `ssh` said.
    ///
    /// There is NO oracle for this classification — the preflight returns `ssh`'s first stderr line and
    /// the renderer shows it — so the codes come from the design's vocabulary and the patterns from
    /// OpenSSH's own messages. Order matters: a changed host key also prints "Host key verification
    /// failed", and reporting that as unreachable would send someone to check their network when the fix
    /// is `known_hosts`.
    pub fn probe_fault(&self, outcome: &CommandExecutionResult) -> Diagnostic {
        let reason = outcome
            .stderr
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or_default();
        if outcome
            .stderr
            .contains("REMOTE HOST IDENTIFICATION HAS CHANGED")
            || outcome.stderr.contains("Host key verification failed")
        {
            return Diagnostic::with_params(
                DiagnosticCode::SshHostKeyChanged,
                serde_json::json!({ "host": self.host() }),
            );
        }
        if outcome.stderr.contains("Permission denied")
            || outcome.stderr.contains("Too many authentication failures")
            || outcome.stderr.contains("No such identity")
        {
            return Diagnostic::with_params(
                DiagnosticCode::SshAuthFailed,
                serde_json::json!({ "host": self.host(), "user": self.user() }),
            );
        }
        // The default, and it carries `reason` because refused, timed out and unresolvable are all
        // "unreachable" while the difference between them is the entire actionable content —
        // `API_UNREACHABLE` carries one for the same purpose.
        Diagnostic::with_params(
            DiagnosticCode::SshUnreachable,
            serde_json::json!({
                "host": self.host(),
                "port": self.credentials.port(),
                "reason": reason,
            }),
        )
    }

    /// Whether the host actually ran the command. A zero exit alone is not evidence: a shell that prints
    /// a banner and exits 0 has not shown it can run what the engine needs — the same rule
    /// the SSH transport's own scope probe applies.
    pub fn echoed(outcome: &CommandExecutionResult) -> bool {
        outcome.success() && outcome.stdout.contains(PREFLIGHT_SENTINEL)
    }
}
