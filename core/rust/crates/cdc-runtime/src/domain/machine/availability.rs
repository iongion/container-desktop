//! The availability verdict — `isApiAvailable` composed with `isApiRunning` (`host-client.ts`).
//!
//! Split out of [`super`] when the readiness probe pushed that file past the 600-line cap, and it is
//! the right seam: every other sub-step asks a UNIT to do something, while this one reaches the engine
//! itself and states the rule for what its answer means.

use std::path::Path;

use super::{ConnectionMachine, ok_diagnostic, proxy, reported};
use crate::capabilities::http::{Endpoint, HttpRequest};
use crate::domain::diagnostic::Diagnostic;
use crate::domain::types::diagnostic::{DiagnosticCode, DiagnosticSeverity, ReportedDiagnostic};
use crate::domain::types::engine::{AvailabilityReport, EngineConnectorAvailability, Program};
use crate::runtimes::composition::HostContext;
use crate::runtimes::host_client::HostClient;

/// What the engine answers a ping with when it is up — `response?.data === "OK"`.
const PING_OK: &str = "OK";

impl ConnectionMachine {
    /// The availability verdict this phase can reach.
    ///
    /// `controller` and `controllerScope` are absent because those dimensions are not ported yet —
    /// and when they are, they must port the FIXED behaviour: `getAvailability` used to report the
    /// CONTROLLER's verdict as the SCOPE's, which is a bug now fixed in `container-client`.
    ///
    /// **`api` means the engine ANSWERED.** It used to mean only that a socket address was resolved,
    /// which is the false-ready defect the design recorded from a live run: a connection whose engine
    /// never started reported itself up.
    pub(super) async fn evaluate_availability(
        &self,
        client: &HostClient,
    ) -> EngineConnectorAvailability {
        let enabled = !self.connection.disabled.unwrap_or(false);
        // Asked of the CLIENT rather than of `self.context`, so the gate can never be handed a
        // platform the client was not built with — the two would drift the moment one grew a field.
        let host = client.profile().is_engine_available(client.platform());
        let host_diagnostic = match &host {
            Ok(()) => ok_diagnostic(),
            Err(diagnostic) => reported(diagnostic, DiagnosticSeverity::Err),
        };
        let host_ok = host.is_ok();

        let program_found = self
            .settings
            .program
            .path
            .as_deref()
            .is_some_and(|path| !path.is_empty());
        let program_diagnostic = if program_found {
            ok_diagnostic()
        } else {
            reported(
                &Diagnostic::with_params(
                    DiagnosticCode::ProgramNotFound,
                    serde_json::json!({ "program": self.settings.program.name }),
                ),
                DiagnosticSeverity::Err,
            )
        };

        // `isApiAvailable` refuses on the base URL FIRST, before the address, and the order is the
        // oracle's. It is not cosmetic: the base URL selects the `Host` header the daemon expects
        // (`"http://d"` for Podman, `"http://localhost"` for Docker and Apple), so a connection
        // without one cannot form a request even over a socket that is bound and serving. Reporting
        // the socket's absence instead would send a user to check an address that is fine.
        let base_url_set = !self.settings.api.base_url.is_empty();
        // **Asked of `proxy::endpoint` rather than of the uri**, so that "an address resolved" means
        // exactly one thing in this tree. It used to read `!uri.is_empty()`, which was the same question
        // while every connection had a local address — and became the WRONG question the moment a bridged
        // one did not: a WSL connection reaching its engine perfectly well over `dial-stdio` carries no
        // uri, and this line reported it `API_SOCKET_UNRESOLVED` and never let the probe run. That is the
        // same defect as a probe and a forward resolving differently, one gate earlier, and the fix is
        // the same: one resolver, asked by both.
        let socket_resolved =
            base_url_set && proxy::endpoint(&self.settings, self.sandboxed()).is_ok();
        // The engine is asked only once everything the question RESTS on has passed — the order
        // `isApiRunning` guards with its own `isApiAvailable` first. A ping at an unresolved address is
        // a request nobody could answer, and letting it fail would replace a precise reason with a
        // vague one. Every one of the three is load-bearing: `a_host_gate_that_fails_asks_the_engine_
        // nothing` and its program sibling are what prove this is a conjunction.
        let serving = if host_ok && program_found && socket_resolved {
            self.probe_api(client).await
        } else {
            Ok(())
        };
        let api_diagnostic = if !host_ok {
            host_diagnostic.clone()
        } else if !program_found {
            program_diagnostic.clone()
        } else if !base_url_set {
            reported(
                &Diagnostic::new(DiagnosticCode::ApiBaseUrlNotSet),
                DiagnosticSeverity::Err,
            )
        } else if !socket_resolved {
            reported(
                &Diagnostic::new(DiagnosticCode::ApiSocketUnresolved),
                DiagnosticSeverity::Err,
            )
        } else if let Err(diagnostic) = &serving {
            reported(diagnostic, DiagnosticSeverity::Err)
        } else {
            ok_diagnostic()
        };
        let api_ok = enabled && host_ok && program_found && socket_resolved && serving.is_ok();
        let api_report = self.fold_api_bridge(client, api_diagnostic, api_ok).await;

        EngineConnectorAvailability {
            enabled,
            host: host_ok,
            program: program_found,
            api: api_ok,
            controller: None,
            controller_scope: None,
            report: AvailabilityReport {
                host: host_diagnostic,
                program: program_diagnostic,
                api: api_report,
                controller: None,
                controller_scope: None,
                detail: None,
            },
        }
    }

    /// Whether anything is SERVING on the resolved address — the second half of `isApiRunning`.
    ///
    /// Three checks, in the original's order. An address that does not resolve to a LOCAL endpoint is
    /// refused and never dialled. Then the socket FILE, because a set-but-wrong native path is the
    /// common failure and the oracle names it precisely rather than as "not reachable"; that check is
    /// skipped on a scoped host, where the socket lives in the guest and only the relay is local. Then
    /// `GET /_ping`.
    ///
    /// **Windows is no longer excluded from the presence check.** The oracle skipped it with a
    /// `// TODO: Check named pipe` and this port copied the hole, and neither could have done otherwise:
    /// a presence check on a pipe used to mean OPENING it, which answers "can I be a client right now"
    /// rather than "is it there" — `false` for a healthy engine whose instances are busy, and a
    /// connection made on the engine's own pipe just to ask. The capability answers a pipe address by
    /// enumerating the pipe filesystem now , so the question is finally
    /// safe to ask, and it is asked. The TODO is closed in the oracle in the same change set.
    ///
    /// **The verdict is the ORACLE's, and it is the BODY:** `result.success = response?.data === "OK"`
    /// (`host-client.ts`). Axios rejects a non-`2xx` before that line, so both halves are required and
    /// both are checked here. [`crate::capabilities::http::HttpResponse::ok`] stays what it says it is —
    /// the generic `2xx` question, for the routes that only need it — because readiness is this type's
    /// rule to state, not the transport's.
    pub(super) async fn probe_api(&self, client: &HostClient) -> Result<(), Diagnostic> {
        // The transport is resolved BEFORE the presence check, so the address CHECKED is the address
        // DIALLED. They diverge otherwise: an `npipe://` uri survives normalization whole (on purpose),
        // and asking the filesystem about that string while dialling the canonical `\\.\pipe\NAME` is
        // two different questions about one engine — the check would refuse an engine that is there.
        // Resolved by `proxy::endpoint`, which is the same two steps a FORWARDED request takes: a probe
        // that agreed an engine was up and then sent its traffic elsewhere is the same class of defect.
        let endpoint = proxy::endpoint(&self.settings, self.sandboxed())?;
        // **A command is not a file, so there is nothing to look for.** Every other kind names something
        // the filesystem can be asked about; `Stdio` names a process to start, and the only question that
        // could be asked ahead of time — does the launcher exist — is one `spawn` answers itself, with a
        // better error than a guess. Checking the WRONG thing here is the mistake this port has already
        // paid for twice (a socket file that outlived its server, a presence check that opened the pipe it
        // measured), and inventing a path for a command would be the third.
        if let Endpoint::UnixSocket(address) | Endpoint::NamedPipe(address) | Endpoint::Tcp(address) =
            &endpoint
            && !client.is_scoped()
            && !client.fs().is_file_present(Path::new(address))
        {
            return Err(Diagnostic::with_params(
                DiagnosticCode::ApiUnreachable,
                serde_json::json!({ "socket": address }),
            ));
        }
        // The same headers a forwarded request carries, and for the same reason: `api.baseURL` selects
        // the `Host` the daemon expects, and a probe that asked with a different one would not be
        // asking the question the engine will be asked afterwards.
        let mut request = HttpRequest::ping(endpoint);
        request.headers = proxy::api_headers(&self.settings.api, &self.context.app_version);
        match client.http().request(&request).await {
            Ok(response) if response.ok() && response.body.trim() == PING_OK => Ok(()),
            // It answered, and not with readiness. The two halves are reported apart because they send
            // someone to different places: a status is the engine refusing, a body is something else
            // answering on the engine's address.
            Ok(response) if !response.ok() => Err(Diagnostic::with_params(
                DiagnosticCode::ApiUnreachable,
                serde_json::json!({ "status": response.status }),
            )),
            Ok(response) => Err(Diagnostic::with_params(
                DiagnosticCode::ApiUnreachable,
                serde_json::json!({ "body": response.body }),
            )),
            Err(error) => Err(Diagnostic::with_params(
                DiagnosticCode::ApiUnreachable,
                serde_json::json!({ "reason": error.to_string() }),
            )),
        }
    }

    /// The API bridge, folded into the api entry — `getAvailability`'s last step (`host-client.ts`).
    ///
    /// The original APPENDS its sentence: `report.api` becomes `"API is running · socktainer 0.3.1"`.
    /// Both halves of that are carried, and they land in different places because they are different
    /// kinds of fact.
    ///
    /// A bridge that is MISSING is the CAUSE of the api refusal, so it becomes the entry's CODE:
    /// `API_UNREACHABLE` names the socket a missing bridge explains, and a user who is told to check a
    /// path that only exists once socktainer runs has been sent to the wrong place.
    ///
    /// A bridge that is PRESENT explains nothing, so it is recorded as PARAMS on whatever the entry
    /// already says. **One entry holds both**: it is a code, a severity and typed parameters, so the
    /// verdict is the first two and the build is the third and they never compete for a slot. That is
    /// what the original's concatenation achieves — a refusal keeps its own reason and gains the bridge
    /// that was in place while it failed — and it is what asks for in so many words,
    /// "presence and version … as a code". No report field and no new code were needed, which is why
    /// this stopped being blocked on the slot it was once recorded as waiting for.
    ///
    /// The original's trailing ` · container 0.5.0` is the ENGINE's `settings.program.version` and is
    /// deliberately NOT carried: a client holding this report holds the same connection's settings, and
    /// the original interpolates it only because a sentence has no other way to reach it.
    ///
    /// Severity follows the dimension this lands in: the reason a check FAILED is `err`, while a bridge
    /// nobody could locate on a connection that answered anyway is a `warn` — the api dimension passed,
    /// and an `err` beside `api: true` in the same struct would contradict it.
    async fn fold_api_bridge(
        &self,
        client: &HostClient,
        api: ReportedDiagnostic,
        api_ok: bool,
    ) -> ReportedDiagnostic {
        // Podman and Docker speak REST natively and answer `None`: no bridge to report on, and the
        // verdict stands exactly as the probe left it.
        let Some(bridge) = client
            .dialect()
            .describe_api_bridge(client, &self.settings)
            .await
        else {
            return api;
        };
        // Installed. An absent path IS "not installed" — the spelling every lookup in this port uses.
        if bridge.path.as_deref().is_some_and(|path| !path.is_empty()) {
            return reached_through(api, &bridge);
        }
        reported(
            &Diagnostic::with_params(
                DiagnosticCode::ApiBridgeNotFound,
                serde_json::json!({ "program": bridge.name }),
            ),
            if api_ok {
                DiagnosticSeverity::Warn
            } else {
                DiagnosticSeverity::Err
            },
        )
    }
}

/// The bridge a connection is reached THROUGH, recorded beside whatever the api entry already says.
///
/// An EMPTY version is what `findProgramVersion` records when its probe fails, and the original reads
/// that as unknown rather than as a version (`program.version ? … : "socktainer (version unknown)"`).
/// So it is left out rather than written as `""` — the same narrowing `AvailabilityCheck.details` was
/// just given, and a report that has finished removing two spellings of nothing does not add a third.
fn reached_through(mut api: ReportedDiagnostic, bridge: &Program) -> ReportedDiagnostic {
    api.params.insert(
        "bridge".to_string(),
        serde_json::Value::String(bridge.name.clone()),
    );
    if let Some(version) = bridge.version.as_deref().filter(|it| !it.is_empty()) {
        api.params.insert(
            "bridge_version".to_string(),
            serde_json::Value::String(version.to_string()),
        );
    }
    api
}
