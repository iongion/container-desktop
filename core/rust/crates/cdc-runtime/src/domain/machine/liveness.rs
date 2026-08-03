//! The two reads that keep a live connection live (, `engineDataService.ts`).
//!
//! Reaching `ready` proves the engine answered ONCE. After that the phase is a claim with nothing
//! behind it until something asks again, and the original asks in two ways that do different jobs:
//!
//! - [`ConnectionMachine::watch_events`] holds `/events` open. Its END is the TRIGGER — an engine
//!   that stopped, a tunnel that broke, a laptop that slept all close the stream, and none of them
//!   announce themselves any other way (`connectEvents`/`onDropped`).
//! - [`ConnectionMachine::probe`] asks `/_ping`. That is the VERDICT, and it is separate because the
//!   trigger is occasionally wrong: a teardown burst can exhaust an engine's listen backlog and take
//!   the stream down for something that clears in seconds. The original pings three times across six
//!   seconds before believing it (`handleEventsDrop`/`pingUntilAvailable`), and flapping a working
//!   connection into `reconnecting` is worse than noticing a real drop six seconds late.
//!
//! **Neither one decides anything.** They are reads; what a drop MEANS is
//! [`ConnectionMachine::dropped`]'s, and how long to wait between the pings belongs to whoever owns
//! the waiting — which is the server, for the reason [`super`]'s module doc gives about timers.
//!
//! **Both resolve their address through `proxy::endpoint`**, the same two steps the readiness probe
//! and a forwarded request take. An engine watched at one address and dialled at another is a
//! liveness answer about something else, and this port has already paid twice for a check that asked
//! about the wrong thing.

use super::{ConnectionMachine, proxy};
use crate::capabilities::http::{HttpRequest, HttpStreamOpen};
use crate::domain::diagnostic::Diagnostic;

impl ConnectionMachine {
    /// Attach to the engine's event stream, the signal that says this connection is still alive.
    ///
    /// **The bytes are not this port's.** The original consumes them to refresh its resource caches;
    /// there are none here, so what a caller does with the body is read it until it ends. That is not
    /// a degenerate use of the stream — it is the same thing the original does with the CLOSE, and
    /// the close is the only part either of them uses to decide anything.
    ///
    /// **No `since`, and that is a divergence with a reason.** The original passes
    /// `Math.floor(Date.now() / 1000)` so a reconnecting client does not replay events it already
    /// handled. This core's clock is documented as monotonic with an ARBITRARY origin
    /// (`AppRuntimeSnapshot::now`), so dividing it by a thousand produces a number that is a unix
    /// timestamp only by accident of the current [`Clock`](crate::capabilities::clock::Clock)
    /// implementation — and under a fake one it is a lie the engine would act on. Both engines stream
    /// from the present when `since` is absent, which is the only thing a liveness watch wants.
    ///
    /// **Untimed, and that is the load-bearing part** — see [`HttpRequest::timeout`]. `/events` is
    /// mostly idle by nature, so a finite read timeout aborts it seconds after it opens and the
    /// caller re-attaches: an events-first design becomes a reconnect POLL loop, quietly, while every
    /// test still passes. The original states the same rule at the same seam
    /// (`host-client.ts:getEventsStream`).
    pub async fn watch_events(&self) -> Result<HttpStreamOpen, Diagnostic> {
        let request = HttpRequest {
            endpoint: proxy::endpoint(&self.settings, self.sandboxed())?,
            method: "GET".to_string(),
            path: "/events".to_string(),
            headers: proxy::api_headers(&self.settings.api, &self.context.app_version),
            body: None,
            timeout: None,
        };
        self.http.stream(&request).await.map_err(proxy::unreachable)
    }

    /// Ask the engine whether it is still answering — `isApiRunning`, one attempt.
    ///
    /// The SAME question the availability check asks, through the same code, so a connection that is
    /// declared dropped fails exactly the check that would have refused it at connect time. One
    /// attempt rather than the grace window, because how many times to ask and how long to leave
    /// between is a schedule, and a schedule needs a timer this type is deliberately without.
    ///
    /// The client is rebuilt per call, as every attempt rebuilds it: the units are stateful, and a
    /// probe through a client left over from an earlier attempt would be asking through a scope that
    /// may since have gone.
    pub async fn probe(&self) -> Result<(), Diagnostic> {
        let client = self.build_client()?;
        self.probe_api(&client).await
    }
}
