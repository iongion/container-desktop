//! How a machine BUILDS the client it drives, and what it can ask before it drives one.
//!
//! Split out of [`super`] when the flatpak rule and the design's discovery pushed that file past the
//! 620-line cap, and it is a real seam rather than a slice taken to fit: every method here answers
//! "which units is this connection, and where do they run" — the composition, the scope it is
//! attached to, whether its socket needs re-spelling for a sandbox, and the one question
//! (`list_contexts`) that can be asked of a connector that has never come up.
//!
//! What stays in [`super`] is the LIFECYCLE: the phases, the attempt, the back-off and the projection.

use super::{ConnectionMachine, scope_not_found};
use crate::domain::diagnostic::Diagnostic;
use crate::domain::proxy::resolve_connection;
use crate::domain::types::diagnostic::DiagnosticCode;
use crate::domain::types::engine::EngineContext;
use crate::domain::types::machine::ControllerScope;
use crate::runtimes::composition::HostContext;
use crate::runtimes::host_client::{HostClient, HostClientComposition, HostEnvironment};
use crate::runtimes::registry::compose;
use crate::runtimes::transports::shared::{named_scope, scope_name};
use std::sync::Arc;

impl ConnectionMachine {
    /// Whether this connection's engine socket has to be re-spelled for a flatpak sandbox.
    ///
    /// The conjunction of the two halves, in one place so the four resolvers cannot disagree: whether
    /// this PROCESS is sandboxed (host knowledge, on the context) and whether THIS host's socket is a
    /// host path at all (`HostProfile::sandbox_maps_socket` — the oracle's list of eight, as the
    /// property that list encodes).
    ///
    /// A connector that will not compose answers `false`: a connection that cannot be built has no
    /// address to re-spell, and the refusal belongs to whoever tried to build it.
    pub(super) fn sandboxed(&self) -> bool {
        self.context.is_flatpak
            && compose(self.connection.engine, self.connection.host)
                .is_ok_and(|units| units.profile.sandbox_maps_socket())
    }

    /// The named endpoints this connection's engine offers on its host — the design's discovery.
    ///
    /// **It does not connect, and it does not need to.** Asking a CLI what it can be pointed at is a
    /// question about the machine rather than about a running engine, so a connection that is down
    /// still answers it — which is the point: a person chooses a context BEFORE the connection works.
    ///
    /// The scope is attached first, because a scoped connection's contexts are the ones inside the
    /// scope: `docker context ls` run on this machine would answer about the wrong docker.
    pub async fn list_contexts(&self) -> Result<Vec<EngineContext>, Diagnostic> {
        let client = self.attach_scope(self.build_client()?).await?;
        client
            .dialect()
            .list_contexts(&client, &self.settings)
            .await
    }

    /// Compose the units for this connector and wrap them in the client that owns them.
    ///
    /// Built per attempt, as the original rebuilds the host from `connection.settings`: the units are
    /// stateful (SSH, WSL and podman-machine keep per-connection state) and reusing one across a
    /// reconnect is how a stale scope survives a retry.
    pub(super) fn build_client(&self) -> Result<HostClient, Diagnostic> {
        // Every REGISTERED connector composes now, so the only way this fails is a settings file
        // naming a pair no release ever offered — which has nothing to add beyond the pair itself.
        let units = compose(self.connection.engine, self.connection.host).map_err(|_| {
            Diagnostic::with_params(
                DiagnosticCode::HostNotSupported,
                serde_json::json!({
                    "engine": self.connection.engine.to_string(),
                    "host": self.connection.host.to_string(),
                }),
            )
        })?;
        let composition = HostClientComposition {
            transport: units.transport,
            dialect: units.dialect,
            profile: units.profile,
            program: units.program,
            controller: units.controller,
        };
        let environment = HostEnvironment {
            os_type: self.context.os,
            arch: self.context.arch.clone(),
            home: self.context.home.clone(),
            user_data_path: self.context.user_data_path.clone(),
            is_flatpak: self.context.is_flatpak,
            log_level: self.context.log_level.clone(),
            app_version: self.context.app_version.clone(),
            // The connection's own setting joined with the global one, from the CONNECTION rather
            // than from `self.settings`: the latter is what detection resolved, and detection has
            // nothing to say about a proxy.
            proxy: resolve_connection(
                self.context.proxy.as_ref(),
                self.connection.settings.proxy.as_ref(),
            ),
        };
        Ok(HostClient::new(
            self.connection.id.clone(),
            composition,
            environment,
            self.settings.clone(),
            Arc::clone(&self.command),
            Arc::clone(&self.fs),
            Arc::clone(&self.http),
        )
        .with_scope(self.resolve_scope()))
    }

    /// Resolve the scope this connection NAMES and hand the client that will use it.
    ///
    /// **Two sources, and only the first is data.** Reading `~/.ssh/config` is the one listing the
    /// runtime cannot do, so SSH hosts arrive on the context. Everything else is known only to the
    /// transport — `wsl -l -v`, `limactl list`, `podman machine list` — which is what
    /// `isControllerScopeAvailable` asks (`getControllerScopes` → `transport.listScopes`, found by
    /// `Name`). Asking needs a client, which is why this is here and not in [`Self::build_client`].
    ///
    /// Consulting only the context is what made four of the twelve connectors unreachable: both
    /// engines on WSL and both on Lima name a scope no ssh config can contain, so every one of them
    /// was refused as NOT FOUND. Driven on `win11`: `SCOPE_NOT_FOUND` with an empty `available`
    /// against a distribution that was running.
    pub(super) async fn attach_scope(&self, client: HostClient) -> Result<HostClient, Diagnostic> {
        let named = self.named_scope();
        if !client.is_scoped() || named.is_empty() || client.scope().is_some() {
            return Ok(client);
        }
        // A listing that fails is no scopes, exactly as the original's `catch` leaves it — the
        // refusal below then names what there was, which is nothing.
        let offered = client
            .transport()
            .list_scopes(&client, &self.settings)
            .await
            .unwrap_or_default();
        if let Some(found) = offered.iter().find(|scope| scope_name(scope) == named) {
            let found = found.clone();
            return Ok(client.with_scope(Some(found)));
        }
        let mut available = self.context.scopes.clone();
        available.extend(offered);
        Err(scope_not_found(named, &available))
    }

    /// The scope the settings NAME, found among the ones the host offers.
    ///
    /// `None` rather than a refusal, and the refusal is not lost: an unscoped host has no scope by
    /// definition, and a scoped one whose scope is missing is refused by its own TRANSPORT with the
    /// reason only it can give (`SCOPE_NOT_SET`, naming the transport). Refusing here instead would
    /// mean guessing that reason before the transport is even known.
    pub(super) fn resolve_scope(&self) -> Option<ControllerScope> {
        let named = self.named_scope();
        if named.is_empty() {
            return None;
        }
        self.context
            .scopes
            .iter()
            .find(|scope| scope_name(scope) == named)
            .cloned()
    }

    /// What `settings.controller.scope` says, which is a NAME and may be nothing.
    pub(super) fn named_scope(&self) -> &str {
        named_scope(&self.settings)
    }
}
