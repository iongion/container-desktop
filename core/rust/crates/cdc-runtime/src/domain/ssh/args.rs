//! The `ssh` argv, ported from `ssh-args.ts`.
//!
//! Every option below is a fixed bug rather than a preference — `BatchMode` so a prompt cannot hang
//! the connection, `ConnectTimeout` plus `ConnectionAttempts=1` so an unreachable host fails fast,
//! `-p` always present because a missing one silently broke non-22 hosts — which is why the whole
//! argv is specified here and pinned positionally rather than assembled at each call site.
//!
//! `buildSSHBaseArgs`'s `connectTimeoutSeconds` option is NOT ported: every caller in the oracle,
//! including the preflight that appears to override it, passes the default. An injection point with
//! one value is a parameter nobody can get wrong and nobody can test.

use crate::domain::argv::SSH_CONNECT_TIMEOUT_SECONDS;
use crate::domain::pathing::expand_home;
use crate::domain::types::connection::SshHost;
use crate::runtimes::dialects::shared::strip_scheme;

/// What `ssh` uses when no port is configured.
pub const DEFAULT_SSH_PORT: i64 = 22;

/// `ssh-args.ts:SSHClientConnection` — what the builders need to reach a host.
///
/// Every field the oracle treats as falsy-means-absent is an `Option` here, so the falsiness is
/// decided once, in [`SshCredentials::from_scope`], instead of at each of the places that ask.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SshCredentials {
    pub host: String,
    /// Kept as the schema's integer rather than narrowed to a `u16`: a nonsense port must REACH
    /// `ssh` and be refused there. Narrowing would turn it into "absent" and silently connect to
    /// port 22 — a different service on the right host, which is the worse failure.
    pub port: Option<i64>,
    pub username: Option<String>,
    pub private_key_path: Option<String>,
    /// A `~/.ssh/config` alias. When set it OWNS the port and the identity, so both are suppressed.
    pub config_host: Option<String>,
}

impl SshCredentials {
    /// `ssh-transport.ts:startSSHConnection` — a discovered scope as connect parameters.
    ///
    /// `home` is passed in because expanding `~` is the caller's knowledge, not the domain's; the
    /// whole crate stays free of the environment for the same reason time is a parameter.
    pub fn from_scope(scope: &SshHost, home: &str) -> Self {
        Self {
            // `HostName` is what the alias resolves to, `Host` is what the user wrote, and `Name` is
            // all an alias-only entry has.
            host: [&scope.host_name, &scope.host, &scope.name]
                .into_iter()
                .find(|value| !value.is_empty())
                .cloned()
                .unwrap_or_default(),
            port: (scope.port != 0).then_some(scope.port),
            username: (!scope.user.is_empty()).then(|| scope.user.clone()),
            private_key_path: (!scope.identity_file.is_empty())
                .then(|| expand_home(&scope.identity_file, home)),
            config_host: scope
                .config_host
                .as_deref()
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        }
    }

    /// The configured port, or the default. The oracle spells `|| 22` at all three of its call
    /// sites; one accessor is one rule.
    pub fn port(&self) -> i64 {
        self.port.unwrap_or(DEFAULT_SSH_PORT)
    }

    /// `buildSSHBaseArgs`.
    pub fn base_args(&self) -> Vec<String> {
        let mut args = vec![
            "-oStrictHostKeyChecking=accept-new".to_string(),
            "-oBatchMode=yes".to_string(),
            format!("-oConnectTimeout={SSH_CONNECT_TIMEOUT_SECONDS}"),
            "-oConnectionAttempts=1".to_string(),
        ];
        if self.config_host.is_some() {
            // Both suppressions have the same cause, so they are one branch: the alias' own
            // `Port` and `IdentityFile` are what the user configured, and passing either here
            // overrides them without saying so.
            return args;
        }
        if let Some(key) = &self.private_key_path {
            args.push("-i".to_string());
            args.push(key.clone());
        }
        args.push("-p".to_string());
        args.push(self.port().to_string());
        args
    }

    /// `buildSSHTarget` — what `ssh` is told to connect to.
    pub fn target(&self) -> String {
        self.config_host
            .clone()
            .unwrap_or_else(|| self.user_at_host())
    }

    /// `buildSSHArgs` — base args, target, `--`, then the remote command.
    pub fn args(&self, command: &[String]) -> Vec<String> {
        let mut args = self.base_args();
        args.push(self.target());
        // Without it, a remote argument that starts with `-` is read by the LOCAL ssh as an option.
        args.push("--".to_string());
        args.extend(command.iter().cloned());
        args
    }

    /// `buildSSHTunnelArgs` — a different shape from [`args`](Self::args), not a variation on it:
    /// the forward options come after the base args, the target comes LAST, and there is no `--`
    /// because `-NL` carries no remote command.
    pub fn tunnel_args(&self, local_address: &str, remote_address: &str) -> Vec<String> {
        let mut args = self.base_args();
        // Fail the spawn when the forward cannot be bound, and clear a stale socket file rather
        // than refusing to bind over it.
        args.push("-oExitOnForwardFailure=yes".to_string());
        args.push("-oStreamLocalBindUnlink=yes".to_string());
        args.push("-NL".to_string());
        args.push(format!("{local_address}:{}", forward_path(remote_address)));
        args.push(self.target());
        args
    }

    /// `buildSSHConnectionURI` — the endpoint as written for a human, which is why it names the
    /// literal host and port even when an alias is what `ssh` will be given.
    pub fn connection_uri(&self) -> String {
        format!("{}:{}", self.user_at_host(), self.port())
    }

    fn user_at_host(&self) -> String {
        match &self.username {
            Some(username) => format!("{username}@{}", self.host),
            None => self.host.clone(),
        }
    }
}

/// `startTunnel` strips the scheme before building the forward, because `-NL` takes a PATH.
///
/// Deliberately not `normalize_unix_socket_path`: that one answers "" for a scheme it does not
/// speak, which here would build `-NL local:` — a forward that binds to nothing. Passing an
/// unknown address through leaves `ssh` to refuse it out loud.
fn forward_path(remote_address: &str) -> &str {
    strip_scheme(remote_address, "unix://").unwrap_or(remote_address)
}
