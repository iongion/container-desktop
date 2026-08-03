//! `runtimes/dialects/podman.ts` — the Podman engine, native and remote.
//!
//! Two ways of asking where podman listens, and the order matters: a remote MAC is asked for its
//! machine's socket first, because `system info` there answers about the wrong thing. See
//! `read_remote_machine_socket` for how that host is recognised WITHOUT matching on its type.

use async_trait::async_trait;

use crate::domain::types::connection::{
    ConnectorCapabilities, EngineConnectorSettings, ExtensionFlags, ResourceCapabilities,
};
use crate::domain::types::engine::{ApiSurface, ContainerEngine};
use crate::runtimes::composition::{EngineDialect, EngineEnvironment, HostContext};
use crate::runtimes::dialects::shared::{
    expand_scoped_socket_path, is_scoped_macos, normalize_unix_socket_path,
};
use crate::runtimes::sort_capabilities;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PodmanDialect;

/// `info.host.remoteSocket.path` — Podman reports its own listening socket.
///
/// Pure and separate from the command that produces the stdout, so the parse rule can be pinned
/// without a host. Unparseable output is an empty socket, exactly as the original's `catch` leaves
/// it — a detection failure, not a crash.
pub fn read_socket_from_info(stdout: &str) -> String {
    let Ok(info) = serde_json::from_str::<serde_json::Value>(stdout) else {
        return String::new();
    };
    normalize_unix_socket_path(
        info.pointer("/host/remoteSocket/path")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default(),
    )
}

/// `pickPodmanMachineSocket` — the RUNNING machine's socket, else the first one listed.
///
/// Pure, so the selection rule is pinned without a host. `machine inspect` answers an ARRAY, but the
/// original also accepts a lone object, and a machine that is not running still has a socket PATH —
/// which is why a stopped machine is a usable answer rather than no answer at all.
pub fn pick_podman_machine_socket(stdout: &str) -> String {
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(stdout) else {
        return String::new();
    };
    let items = match parsed {
        serde_json::Value::Array(items) => items,
        serde_json::Value::Null => Vec::new(),
        single => vec![single],
    };
    let running = items
        .iter()
        .find(|item| item.pointer("/State").and_then(serde_json::Value::as_str) == Some("running"));
    let Some(item) = running.or_else(|| items.first()) else {
        return String::new();
    };
    normalize_unix_socket_path(
        item.pointer("/ConnectionInfo/PodmanSocket/Path")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default(),
    )
}

/// `readPodmanRemoteMachineSocket` — a podman MACHINE running on a remote Mac.
///
/// Its API socket lives inside the machine, and `system info` over that connection does not name it,
/// so the machine has to be inspected directly and its `~`/`$HOME` expanded against the REMOTE home.
///
/// **The original selects this branch with `host.HOST === PODMAN_REMOTE` and then probes
/// `isScopedMacOS`; here the probe stands alone, and it selects the same set.** Every scope that is
/// not an SSH remote has a Linux guest by construction — a WSL distribution, a LIMA instance and a
/// podman machine are all Linux VMs — so "scoped AND the guest says Darwin" is true for remote Macs
/// and for nothing else. A `HostClient` may never match on host type, and this is what that rule
/// costs: one `uname -s` on each scoped detection, where the original pays none for its three
/// virtualized hosts. The oracle's extra guard is a cheap PRE-FILTER over the identical set, not a
/// different rule, so it is not a divergence in behaviour — only in round-trips.
///
/// Empty for an unscoped host without running anything: `run_scope_command` refuses, and a refusal
/// here means "not this kind of host", which is the same answer as "no machine".
async fn read_remote_machine_socket(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
) -> String {
    if !host.is_scoped() || !is_scoped_macos(host, settings).await {
        return String::new();
    }
    let args = ["machine".to_string(), "inspect".to_string()];
    // A transport refusal and a non-zero exit are the SAME answer here — "this host has no machine
    // to inspect" — and writing them as one arm is what keeps the pair from looking like two
    // different outcomes a reader has to tell apart.
    let stdout = match host.run_engine_command(&args, settings).await {
        Ok(outcome) if outcome.success() => outcome.stdout,
        _ => return String::new(),
    };
    expand_scoped_socket_path(host, settings, &pick_podman_machine_socket(&stdout)).await
}

#[async_trait]
impl EngineDialect for PodmanDialect {
    fn engine(&self) -> ContainerEngine {
        ContainerEngine::Podman
    }

    /// Podman's own table. `machines` is podman's alone, `kube` is `podman generate kube`, and
    /// `contexts`/`swarm` are docker's — declared false rather than omitted, because every host answers
    /// for every extension.
    fn capabilities_base(&self) -> ConnectorCapabilities {
        ConnectorCapabilities {
            events: true,
            extensions: ExtensionFlags {
                builders: false,
                compose: true,
                contexts: false,
                controller_version: false,
                kube: true,
                machines: true,
                registries: true,
                registry_trust: true,
                swarm: false,
            },
            resources: ResourceCapabilities {
                networks: true,
                pods: true,
                secrets: true,
            },
            sort: sort_capabilities::podman(),
        }
    }

    fn api_surface(&self) -> ApiSurface {
        ApiSurface::Libpod
    }

    /// The machine's socket on a remote Mac, else what `system info` reports.
    ///
    /// The order is the original's and it is load-bearing: on a remote Mac `system info` answers
    /// about a connection that cannot be dialed, so asking it first would produce an address that
    /// looks resolved and reaches nothing. Every other host skips the first read for the price of
    /// one `uname -s` — see `read_remote_machine_socket`.
    async fn read_engine_socket(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> String {
        let remote_machine = read_remote_machine_socket(host, settings).await;
        if !remote_machine.is_empty() {
            return remote_machine;
        }
        let args = ["system", "info", "--format", "json"].map(str::to_string);
        let Ok(outcome) = host.run_engine_command(&args, settings).await else {
            return String::new();
        };
        if !outcome.success() {
            return String::new();
        }
        read_socket_from_info(&outcome.stdout)
    }

    /// NONE, deliberately.
    ///
    /// Podman does have an analogue — `--connection <name>`, over `podman system connection list` —
    /// and this port already consumes those connections, as the MACHINE SCOPES a transport enters
    /// (`podman_machine_connections`). Selecting the same machine a second way here would be a
    /// second source able to disagree with the scope the connection resolved.
    fn target_args(&self, _settings: &EngineConnectorSettings) -> Vec<String> {
        Vec::new()
    }

    /// Podman disguised as Docker is honoured too, which is why `DOCKER_HOST` appears here.
    fn native_uri_seed(&self, environment: &EngineEnvironment) -> String {
        let podman = environment.podman_host.as_deref().unwrap_or_default();
        if !podman.is_empty() {
            return podman.to_string();
        }
        environment.docker_host.clone().unwrap_or_default()
    }

    fn build_service_args(&self, socket_path: &str, log_level: &str) -> Option<Vec<String>> {
        Some(vec![
            "system".to_string(),
            "service".to_string(),
            "--time=0".to_string(),
            format!("unix://{socket_path}"),
            format!("--log-level={log_level}"),
        ])
    }

    fn dial_stdio_program(&self) -> Option<&'static str> {
        Some("podman")
    }
}
