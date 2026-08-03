//! Automatic-settings detection.
//!
//! The original is `profiles/shared.ts:defaultGetAutomaticSettings` composed with
//! `host-client.ts:findHostProgram` and the profile's `getApiConnection` — a sequence of `await`s.
//! It is that here too. It used to be an explicit resumable state machine, which existed so an
//! executor could drive it; that went with the executor.
//!
//! Finding a program is delegated to [`crate::domain::program`], not repeated here: the same
//! lookup is used on its own by the availability check, and two copies of the
//! `which`/`whereis`/registry ladder would drift.
//!
//! A SCOPED host has TWO programs and the original detects them differently — the CONTROLLER with
//! `findHostProgram` because it is what ENTERS the scope, the ENGINE with `findScopeProgram`
//! because it lives inside one. Everything after that is the identical sequence: the wrapping is one
//! place ([`HostContext::run_probe`]) and it branches on the transport's CAPABILITY, never on the
//! host type — a second `match` on engine or host is how the seam's invariant gets broken next.

use crate::domain::program::{ProgramLookup, ProgramProbe};
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::engine::{Controller, Program};
use crate::runtimes::composition::{EngineEnvironment, HostContext, ResolvedApi, UnitResult};
use crate::runtimes::transports::shared::{named_scope, scope_name, scope_usable};

/// Resolve everything automatic settings can decide, and answer the settings that result.
///
/// The input `settings` are the CANDIDATE — what the connection carries going in — and they are
/// never read back off the context, because during an attempt the context still holds the previous
/// answer.
///
/// The order is the specification: the OS gate first (there is no point probing an engine that
/// cannot run here), then the programs, then the engine's own socket, and only then the ranking that
/// composes the API connection from all three.
pub async fn detect_automatic_settings(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
    environment: &EngineEnvironment,
) -> UnitResult<EngineConnectorSettings> {
    host.profile().is_engine_available(host.platform())?;
    let mut resolved = settings.clone();

    // 1.0 — the programs. The original's own `if (host.isScoped())`, and the branch is the caller's
    // here for the same reason it is there: which of the two lookups to run is not a thing a lookup
    // can decide for itself.
    if host.is_scoped() {
        detect_scoped_programs(host, &mut resolved).await?;
    } else {
        resolved.program = engine_program(host, &resolved).await;
    }

    // 2.0 — the API connection.
    //
    // Asked with the settings the program lookup just resolved, not the ones that came in — the
    // whole point of re-detecting the path is to use it.
    let socket = host.dialect().read_engine_socket(host, &resolved).await;
    let seed = host.dialect().native_uri_seed(environment);
    let scope_uri = host
        .transport()
        .resolve_scope_uri(host, &resolved, &socket)
        .await;
    let local_fallback = host.transport().local_forward_fallback(host).await;
    let probed = host.profile().probe_uri(host, &resolved).await;
    // Asked AFTER `read_engine_socket`, because the bridge points at what the engine reported it is
    // listening on — `getApiConnection` resolves it from the same settings for the same reason.
    let dial_stdio = host
        .transport()
        .resolve_dial_stdio(host, &resolved, &socket)
        .await;
    let configured = resolved.api.connection.clone();

    resolved.api.connection = host.profile().api_connection(&ResolvedApi {
        socket: &socket,
        seed: &seed,
        scope_uri: &scope_uri,
        configured: &configured,
        local_fallback: &local_fallback,
        probed: &probed,
        dial_stdio: &dial_stdio,
        os: host.os_type(),
    });
    Ok(resolved)
}

/// The controller, then the scope, then the engine inside it — `shared.ts:121-147`.
///
/// Each step gates the next, and the order is why: the controller's PATH is what the transport runs
/// to list its scopes, and a scope that is not usable is one nothing can be asked of.
async fn detect_scoped_programs(
    host: &dyn HostContext,
    resolved: &mut EngineConnectorSettings,
) -> UnitResult<()> {
    let named = named_scope(resolved).to_string();
    let found = ProgramProbe::find_host_program(
        host.controller(),
        // Never the scoped cascade: this runs HERE, so the local os is the one that chooses.
        ProgramLookup::for_target(host.os_type(), false),
    )
    .run(host, resolved)
    .await;
    resolved.controller = Some(controller(&found, &named));

    if !named.is_empty() {
        resolved.program = engine_program(host, resolved).await;
        return Ok(());
    }

    // Nothing named a scope, so ask the transport for its default and ADOPT it. WSL, LIMA and
    // podman-machine enter their scope with the CONTROLLER, and until this ran nothing detected it.
    let Some(default_scope) = host
        .transport()
        .controller_default_scope(host, resolved)
        .await?
    else {
        // "No default scope found - program will not be detected". The engine is LEFT as it came in
        // rather than replaced with an absence: nothing was asked, so nothing was learned.
        return Ok(());
    };
    resolved.controller = Some(controller(&found, scope_name(&default_scope)));
    if !scope_usable(&default_scope) {
        // "Default scope is not usable - program will not be detected."
        return Ok(());
    }
    // **This probe cannot succeed on the attempt that discovered the scope**, and that is the
    // oracle's shape rather than an oversight: a scope arrives at a transport as a VALUE
    // ([`HostContext::scope`]) resolved before the client was built, so the NAME just adopted
    // reaches the next attempt and not this one.
    resolved.program = engine_program(host, resolved).await;
    Ok(())
}

/// The ENGINE binary, wherever this connection's engine lives.
///
/// The original re-detects from the program NAME every time, discarding whatever path was stored —
/// a moved binary must not keep resolving to its old location.
async fn engine_program(host: &dyn HostContext, settings: &EngineConnectorSettings) -> Program {
    let lookup = ProgramLookup::for_target(host.os_type(), host.is_scoped());
    let name = settings.program.name.clone();
    if host.is_scoped() {
        return ProgramProbe::find_scope_program(name, lookup)
            .run(host, settings)
            .await;
    }
    ProgramProbe::find_host_program(name, lookup)
        .run(host, settings)
        .await
}

/// `settings.controller = program` followed by `settings.controller.scope = scope` — the assignment
/// and the put-back, in that order, because a program lookup answers no scope of its own.
///
/// `Program::path` is ABSENT when nothing was found and `Controller::path` is a `String`, so an
/// undetected controller reads as EMPTY here — which is exactly what
/// [`crate::runtimes::transports::shared::controller_launcher`] already treats as absent.
fn controller(program: &Program, scope: &str) -> Controller {
    Controller {
        auto: program.auto,
        homepage: program.homepage.clone(),
        name: program.name.clone(),
        path: program.path.clone().unwrap_or_default(),
        scope: (!scope.is_empty()).then(|| scope.to_string()),
        title: program.title.clone(),
        version: program.version.clone(),
    }
}
