//! `runtimes/dialects/docker.ts` — the Docker engine.

use async_trait::async_trait;

use crate::capabilities::command::HostCommand;
use crate::domain::types::connection::{
    ConnectorCapabilities, EngineConnectorSettings, ExtensionFlags, ResourceCapabilities,
};
use crate::domain::types::engine::{ApiSurface, ContainerEngine, EngineContext};
use crate::runtimes::composition::{EngineDialect, EngineEnvironment, HostContext, UnitResult};
use crate::runtimes::dialects::docker_contexts::{
    CONTEXT_LIST_ARGS, context_target_args, parse_context_list,
};
use crate::runtimes::dialects::shared::normalize_unix_socket_path;
use crate::runtimes::sort_capabilities;
use crate::runtimes::transports::shared::program_launcher;

/// What a scoped Docker is asked for when its context cannot be read.
const DOCKER_HOST_VARIABLE: &str = "DOCKER_HOST";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DockerDialect;

/// The FIRST context's `Endpoints.docker.Host`.
///
/// `context inspect` returns an ARRAY even for one context, and the original takes `[0]`. Pure, so
/// the parse rule is pinned without a host.
pub fn read_socket_from_context(stdout: &str) -> String {
    let Ok(contexts) = serde_json::from_str::<serde_json::Value>(stdout) else {
        return String::new();
    };
    normalize_unix_socket_path(
        contexts
            .pointer("/0/Endpoints/docker/Host")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default(),
    )
}

#[async_trait]
impl EngineDialect for DockerDialect {
    fn engine(&self) -> ContainerEngine {
        ContainerEngine::Docker
    }

    /// Docker's own table.
    ///
    /// `contexts` is TRUE for discovery and inspection; switching is deliberately never offered
    ///, which a compatibility view renders as partial rather than as a plain yes. `swarm`
    /// and `compose` are advertised statically on every docker host — swarm-rest answers an empty
    /// state when the daemon is not a manager, and the compose plugin's absence surfaces at the
    /// deploy pre-flight, both of which degrade better than a matrix that under-claims.
    fn capabilities_base(&self) -> ConnectorCapabilities {
        ConnectorCapabilities {
            events: true,
            extensions: ExtensionFlags {
                builders: false,
                compose: true,
                contexts: true,
                controller_version: false,
                kube: false,
                machines: false,
                registries: false,
                registry_trust: true,
                swarm: true,
            },
            resources: ResourceCapabilities {
                networks: true,
                pods: false,
                secrets: false,
            },
            sort: sort_capabilities::docker(),
        }
    }

    fn api_surface(&self) -> ApiSurface {
        ApiSurface::Docker
    }

    /// The context's endpoint, and — for a SCOPED host only — the guest's `DOCKER_HOST` behind it.
    ///
    /// Docker does not report its socket in `system info`; the context does. When the context cannot
    /// be read there is still one source left inside a guest, and the original reads it: `printenv
    /// DOCKER_HOST` inside the distribution, in `dockerWSLProfile.getApiConnection`.
    ///
    /// **Two divergences, both deliberate.** It lives in the DIALECT here because it answers the
    /// engine's question — "where does this engine listen" — and not one host's; that also means
    /// `docker.remote` gets it, where the original offers it to `docker.virtualized.wsl` alone. And
    /// the value is NORMALISED, because this method's contract is a scheme-stripped path while the
    /// original hands the raw `unix://…` straight through as a relay.
    ///
    /// It costs an unscoped host NOTHING: `scope_environment_variable` answers empty for one without
    /// running anything. A scoped host pays one `printenv`, and only on a path where the context read
    /// has already failed.
    ///
    /// The oracle's own version of this fallback was DEAD until this change set: it was written
    /// `|| ""`, and `getContextInspect` catches its own failure, so the empty return discarded the
    /// fallback on exactly the path it existed for. Fixed in `profiles/docker.ts` with a test.
    async fn read_engine_socket(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> String {
        let args = ["context", "inspect", "--format", "json"].map(str::to_string);
        let from_context = match host.run_engine_command(&args, settings).await {
            Ok(outcome) if outcome.success() => read_socket_from_context(&outcome.stdout),
            _ => String::new(),
        };
        if !from_context.is_empty() {
            return from_context;
        }
        normalize_unix_socket_path(
            &host
                .scope_environment_variable(DOCKER_HOST_VARIABLE, settings)
                .await,
        )
    }

    /// `--context <name>` when the connection named one.
    ///
    /// It is what makes the read above answer about the context this connection MEANS rather than
    /// the one the user last selected in a shell — the same flag, applied once, also retargets the
    /// `system dial-stdio` bridge and beats `DOCKER_HOST`.
    fn target_args(&self, settings: &EngineConnectorSettings) -> Vec<String> {
        context_target_args(settings.context.as_deref())
    }

    /// Every context this docker knows, for a client to offer or a person to choose from.
    ///
    /// **Asked WITHOUT this connection's pin, which is the one command here that must not carry it.**
    /// `context ls` reads the machine's context STORE and dials no endpoint, so `--context` changes
    /// only which row it reports as `Current` — verified against the real CLI: with the machine on
    /// `lima-ubuntu-vm`, `docker --context desktop-linux context ls` marks `desktop-linux` current
    /// and `docker context show` still answers `lima-ubuntu-vm`. Passing the pin would therefore make
    /// every listing agree with the pin by construction, and the `current` a client renders — "what
    /// this connection follows when it does not pin" — would be the pin itself. Found by reading the
    /// live screen, not by a test.
    ///
    /// A listing failure is NO contexts rather than an error, exactly as the socket read degrades:
    /// nothing about a connection depends on this succeeding.
    async fn list_contexts(
        &self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> UnitResult<Vec<EngineContext>> {
        // Straight to `run_probe`, because `run_engine_command` is the seam that applies the pin. The
        // scope is still honoured — a remote's contexts are the REMOTE's, and that is the transport's
        // doing rather than the flag's.
        let mut command = HostCommand::new(program_launcher(settings), &[]);
        command.args = CONTEXT_LIST_ARGS.map(str::to_string).to_vec();
        match host.run_probe(&command, settings).await {
            Ok(outcome) if outcome.success() => Ok(parse_context_list(&outcome.stdout)),
            _ => Ok(Vec::new()),
        }
    }

    fn native_uri_seed(&self, environment: &EngineEnvironment) -> String {
        environment.docker_host.clone().unwrap_or_default()
    }

    /// Docker manages its own service — there is nothing to launch, and `None` means "start the host
    /// manually" rather than "not implemented".
    fn build_service_args(&self, _socket_path: &str, _log_level: &str) -> Option<Vec<String>> {
        None
    }

    /// The reason a Windows remote is reachable at all: its endpoint is a named pipe, which no
    /// `ssh -NL` forward can carry.
    fn dial_stdio_program(&self) -> Option<&'static str> {
        Some("docker")
    }
}
