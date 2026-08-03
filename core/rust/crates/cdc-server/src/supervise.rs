//! What keeps a live connection live, and what retries it when it is not.
//!
//! **This is the caller `ConnectionMachine` was written for and did not have.** `machine.rs` says it
//! in its own module doc — "it computes `next_retry_at` and RETURNS. It does not sleep. The caller
//! waits and calls `connect` again" — and `next_retry_at()`'s doc names the missing party outright:
//! "for the caller that owns the waiting" — and that is the server. Nothing built it before now, so
//! `dropped` had no production caller, `attempt` never left zero, and `reconnecting` — a phase with a
//! policy, a back-off, a stability window and a screen to render it — could not be reached by any
//! running process. This module is that caller.
//!
//! **The cycle is the original's** (`engineDataService.ts`), in its order and for its reasons:
//!
//! 1. **The `/events` stream ends.** That is the TRIGGER, and it is the only one an engine gives:
//!    stopping, a broken tunnel, a slept laptop and a severed network all close the stream and none of
//!    them announce themselves. `connectEvents`/`onDropped`.
//! 2. **The engine is pinged, more than once, with a gap.** That is the VERDICT, and it is separate
//!    because the trigger is occasionally wrong — a teardown burst can exhaust an engine's listen
//!    backlog for something that clears in seconds, and flapping a working connection into
//!    `reconnecting` for that is worse than noticing a real drop six seconds late.
//!    `handleEventsDrop`/`pingUntilAvailable`.
//! 3. **Only a sustained failure is a drop**, and a drop is `ConnectionMachine::dropped`, which is
//!    what puts the connection into `reconnecting` with a delay a client can render.
//! 4. **The delay is waited out and the attempt is made again** — on the SAME machine, because the
//!    attempt counter lives there (see `Server::reconnect`).
//!
//! **One task per watched connection, not a poll over all of them.** A task can be cancelled by name,
//! which is what a user disconnect needs; and its token is a CHILD of the process's shutdown token, so
//! every watcher answers a shutdown without either shutdown path — the listener's and the terminal's —
//! having to know this module exists. Both of them `TaskTracker::wait`, and a task that ignored the
//! token would hang the process on the way out.
//!
//! **Nothing is held across a wait.** The stream is read outside every lock, the gap between pings is
//! slept outside them, and the back-off delay is waited outside them. What a step takes is what that
//! step needs — one attach, one ping, one `dropped`, one `connect` — which is the same shape and
//! duration as a command a client could have issued anyway. The attempt itself is the expensive one and
//! `retry` carries its measurement; what it costs is bounded by [`crate::server`]'s split.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::capabilities::fs::FsLocks;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectProgress, ConnectionPhase};
use tokio_util::sync::CancellationToken;

use crate::listen::session::Shared;
use crate::protocol::{Event, Push};
use crate::server::MachineBuilder;

/// How many times a drop is confirmed before it is believed — `EVENTS_DROP_PING_ATTEMPTS`.
pub const DROP_PING_ATTEMPTS: u32 = 3;

/// How long between those attempts — `EVENTS_DROP_PING_DELAY_MS`.
///
/// Three attempts two seconds apart is a six-second grace window, which is the original's answer to
/// how long a transient socket failure is allowed to last before it counts.
pub const DROP_PING_DELAY: Duration = Duration::from_secs(2);

/// How long a stream must have been open for its END to mean anything — `EVENTS_MIN_UPTIME_MS`.
///
/// A stream that closes the instant it opens never really opened: an engine or a mock with no working
/// `/events` route answers and hangs up, and treating that as a drop would declare a connection dead
/// the moment it came up. What it means instead is "no live events here", and the connection is left
/// alone.
///
/// **Only once the engine has ANSWERED, which is where this port diverges from the original.** The
/// oracle reads the uptime before it pings, so an engine that died as its stream opened is filed under
/// this rule and left rendering `ready` over nothing — see `attend`. What survives is the blind spot
/// that is really one: an engine with no events route is not watched, and nothing will notice when it
/// later goes away.
pub const EVENTS_MIN_UPTIME: Duration = Duration::from_millis(1_500);

/// How long the engine has to produce the RESPONSE HEAD of `/events` before it is taken not to serve
/// events at all.
///
/// **Bounding the ATTACH is not the read timeout `HttpRequest::timeout` forbids**, and the
/// difference is the whole of why this exists. That rule is about the gap between EVENTS, which is
/// unbounded by nature — an idle engine emits nothing for hours and a deadline there turns a stream
/// into a poll loop. This is the gap before the response STARTS, and a working engine closes it
/// immediately: Docker 29.6.2 answers `/events` with `200` and its headers at once.
///
/// **Measured against the engine that does not.** Apple's `container`, reached through socktainer
/// 1.2.0, ROUTES `/events` — a bogus path there answers `404` — and then writes nothing at all: no
/// status line, no headers, zero bytes, held for 25 seconds across a real container event. Without
/// this bound the attach never returns, so `follow` never yields an `Ended`, the watcher parks
/// for the life of the process and the "engine answers but will not stream" arm below — the one
/// written for exactly this engine — is unreachable. The connection meanwhile renders `ready`,
/// which it is.
///
/// **The oracle's own number, and this port had dropped it.** `engineDataService.connectEvents` wraps
/// the attach in `settleWithin(…, EVENTS_ATTACH_TIMEOUT_MS + 500)` and passes the same 3000 ms to the
/// engine as `attachTimeoutMs`. So this is a port defect rather than a design gap, and the constant is
/// that sum rather than a number chosen here — the two trees must give up at the same moment.
pub const EVENTS_ATTACH_LIMIT: Duration = Duration::from_millis(3_500);

/// The three durations a watch is judged by, as one value.
///
/// **Injected for the reason [`Shared::with_handshake_timeout`] already gives about the handshake
/// deadline**: the production numbers are six seconds of pinging and a second and a half of grace,
/// which no hermetic suite can wait for — and an arm nothing executes is an arm nobody has thought
/// about. One value rather than three parameters, because a parameter is something each call site can
/// pass differently and every watcher must judge a drop the same way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WatchSchedule {
    pub ping_attempts: u32,
    pub ping_delay: Duration,
    pub events_min_uptime: Duration,
    pub events_attach_limit: Duration,
}

impl Default for WatchSchedule {
    fn default() -> Self {
        Self {
            ping_attempts: DROP_PING_ATTEMPTS,
            ping_delay: DROP_PING_DELAY,
            events_min_uptime: EVENTS_MIN_UPTIME,
            events_attach_limit: EVENTS_ATTACH_LIMIT,
        }
    }
}

/// The connections currently being watched, and the handle that stops each one.
#[derive(Default)]
pub struct Watchers {
    live: Mutex<BTreeMap<String, CancellationToken>>,
}

impl Watchers {
    pub fn is_watching(&self, connection_id: &str) -> bool {
        self.live
            .lock()
            .expect("watchers")
            .contains_key(connection_id)
    }

    /// Take the slot for this connection, answering the token a new watcher should run under — or
    /// `None` when one is already watching.
    ///
    /// **A CHILD of the process's shutdown token**, so a graceful shutdown cancels every watcher
    /// without either shutdown path knowing this module exists. Both of them close the shared
    /// `TaskTracker` and wait on it, and a watcher that answered only its own token would hang there.
    fn claim(
        &self,
        connection_id: &str,
        shutdown: &CancellationToken,
    ) -> Option<CancellationToken> {
        let mut live = self.live.lock().expect("watchers");
        if live.contains_key(connection_id) {
            return None;
        }
        let token = shutdown.child_token();
        live.insert(connection_id.to_string(), token.clone());
        Some(token)
    }

    /// Give the slot back, but only if it is still THIS watcher's.
    ///
    /// The guard matters: a watcher that exits after its slot was cancelled and re-claimed would
    /// otherwise remove its successor's entry, leaving a running watcher nothing can stop.
    fn release(&self, connection_id: &str, token: &CancellationToken) {
        let mut live = self.live.lock().expect("watchers");
        if live.get(connection_id).is_some_and(|held| held == token) {
            live.remove(connection_id);
        }
    }

    /// Stop watching everything not in `wanted`, and say nothing about the rest.
    fn keep_only(&self, wanted: &[String]) {
        let stopping: Vec<(String, CancellationToken)> = {
            let live = self.live.lock().expect("watchers");
            live.iter()
                .filter(|(id, _)| !wanted.contains(id))
                .map(|(id, token)| (id.clone(), token.clone()))
                .collect()
        };
        for (id, token) in stopping {
            token.cancel();
            self.release(&id, &token);
        }
    }
}

impl<F, B, C> Shared<F, B, C>
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    /// Publish what a connection's progress said, then the state those lines were narrating.
    ///
    /// **The ONE path**, used by a dispatched command, by a watcher, and by the attempt itself as it
    /// runs ([`Shared`]'s `ConnectListener`). Progress is a log and goes to everyone, because a client
    /// that only heard about its own commands would render a workspace where nothing anybody else did
    /// ever happened — and a drop is the case where nobody issued a command at all.
    ///
    /// **Synchronous, and it has to be**: an attempt publishes from inside `ConnectionMachine::connect`
    /// through a trait a `&mut self` sequence can call, which cannot await. Nothing here ever did —
    /// every offer is into a bounded queue and returns at once, which is the invariant
    /// [`crate::listen::clients`] exists to keep.
    pub fn publish(&self, pushes: Vec<Push>) {
        for push in pushes {
            self.clients.broadcast(push);
        }
        // Then the state, once, and only if it moved.
        if let Ok(snapshot) = self.server.snapshot() {
            self.clients.publish(snapshot);
        }
    }

    /// Start and stop watchers so they match the connections the server is holding.
    ///
    /// Called after every command, because a command is the only thing that can bring a connection up
    /// or take one down from outside. A watcher's own transitions do not come through here: it owns
    /// its connection for the whole cycle and answers for it until it exits.
    pub async fn reconcile(self: &Arc<Self>) {
        let wanted = self.server.watched();
        self.watchers.keep_only(&wanted);
        for id in wanted {
            let Some(token) = self.watchers.claim(&id, &self.shutdown) else {
                continue;
            };
            let shared = Arc::clone(self);
            self.tasks.spawn(watch(id, shared, token));
        }
    }
}

/// Watch one connection for as long as it is this process's to watch.
async fn watch<F, B, C>(
    connection_id: String,
    shared: Arc<Shared<F, B, C>>,
    cancel: CancellationToken,
) where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    // Loops once per LIFE of the connection: attach, notice it end, decide, and — when the retry
    // succeeded — attach again to the engine that came back.
    while attend(&connection_id, &shared, &cancel).await == Attended::Again {}
    shared.watchers.release(&connection_id, &cancel);
    tracing::debug!(connection = %connection_id, "no longer watching");
}

/// What became of one turn of the watch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Attended {
    /// The engine is back, or was never gone. Watch it again.
    Again,
    /// There is nothing left to watch: the connection was taken down, it gave up retrying, or this
    /// watcher was cancelled.
    Done,
}

/// How a turn of the watch ran out of stream — the two are not the same evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ended {
    /// It never opened. The engine refused, or could not be reached to ask.
    Attach,
    /// It opened, ran, and finished. How long it lasted is what says whether that means anything.
    Stream { uptime: Duration },
}

/// One turn: hold the stream until it ends, decide what that meant, and see the cycle through.
async fn attend<F, B, C>(
    connection_id: &str,
    shared: &Arc<Shared<F, B, C>>,
    cancel: &CancellationToken,
) -> Attended
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let Some(ended) = follow(connection_id, shared, cancel).await else {
        // Cancelled, or the connection is no longer held: it was disconnected or removed.
        return Attended::Done;
    };

    // **The ping comes first, for every way a stream can run out.** The original asks about the uptime
    // BEFORE it pings (`engineDataService.ts`, `onDropped`), which reads a stream that closed inside the
    // window as "no usable /events here" — true when the engine is fine, and false when the reason the
    // stream closed is that the engine has just gone. Those are the same two readings `follow` refuses
    // to conflate about a failed attach, and the ping is what tells them apart. It costs one request:
    // `still_answering` asks before it sleeps, so an engine that is up answers on the first attempt.
    if still_answering(connection_id, shared, cancel).await {
        return match ended {
            // A hiccup, not a drop. Attach again — which is the whole point of asking twice.
            Ended::Stream { uptime } if uptime >= shared.watch.events_min_uptime => Attended::Again,
            // It opened and closed at once against an engine that is demonstrably fine, so there is no
            // live events route here. Attaching again would be a loop for as long as the connection is
            // up. See `EVENTS_MIN_UPTIME`.
            Ended::Stream { .. } => {
                tracing::info!(
                    connection = %connection_id,
                    "the engine's event stream closed immediately; this connection is not being watched"
                );
                stand_down(connection_id, shared).await;
                Attended::Done
            }
            // The engine is there and will not give us a stream. Attaching again in a loop would
            // spin, so this gives up watching, which is what the original does with the same case
            // (`connectEvents` catches, logs and hands back a no-op handle).
            Ended::Attach => {
                tracing::warn!(
                    connection = %connection_id,
                    "the engine is answering but will not open an event stream; this connection is not being watched"
                );
                stand_down(connection_id, shared).await;
                Attended::Done
            }
        };
    }

    let progress = shared
        .server
        .dropped(connection_id, DiagnosticCode::ApiUnreachable)
        .await;
    // No guard on an empty answer, deliberately. The machine refuses a drop it is not `ready` for and
    // a departed connection answers nothing, so `progress` can legitimately be empty — and `retry`
    // below already reads the phase and leaves for anything that is not `reconnecting`. A second
    // check here would be the same question asked twice, and one of the two would eventually be wrong.
    tracing::warn!(connection = %connection_id, "the engine went away; reconnecting");
    shared.publish(pushes(progress));
    retry(connection_id, shared, cancel).await
}

/// Record on the connection that nothing is watching it, and tell every attached client.
///
/// **Both halves matter.** The record is what stops `reconcile` — which runs after every command —
/// from spawning a replacement watcher that will only give up again; the publication is what a client
/// needs to say "this connection is up and nothing will notice if it stops". Before this, neither
/// happened: the log line above was the whole of it, and it went nowhere a client could read.
async fn stand_down<F, B, C>(connection_id: &str, shared: &Arc<Shared<F, B, C>>)
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    if shared.server.stood_down(connection_id).await {
        // No progress lines: the connection has not moved phase and never will for this. `publish`
        // re-sends the state only if it changed, and the projection's `watched` is what changed.
        shared.publish(Vec::new());
    }
}

/// Hold the engine's event stream until it ends, and say how it ended.
///
/// `None` means there is nothing left to follow — cancelled, or the connection is no longer held.
///
/// **A failed ATTACH is carried back rather than swallowed, and that is where the original has a
/// hole.** `connectEvents` catches, logs and gives up watching — which is right when the engine is
/// there and simply will not open a stream, and wrong when the reason it would not open one is that
/// the engine has gone. Those are the same exception in the original and it takes the first reading
/// for both, so a connection whose engine dies between two streams stays `ready` with nobody
/// watching. Here the two are told apart by the thing that can tell them apart: the ping.
async fn follow<F, B, C>(
    connection_id: &str,
    shared: &Arc<Shared<F, B, C>>,
    cancel: &CancellationToken,
) -> Option<Ended>
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    // **Bounded, where the stream below deliberately is not.** An engine that accepts the connection
    // and never writes a response head would otherwise hold this future for the life of the process:
    // no chunk, no error, no end — nothing to decide on. Timing out reaches the same verdict a refusal
    // does, and the ping then tells "no events here" from "engine gone", which is the distinction this
    // whole function exists to make.
    let attached = tokio::time::timeout(
        shared.watch.events_attach_limit,
        shared.server.watch_events(connection_id),
    )
    .await;
    let Ok(open) = attached else {
        tracing::warn!(
            connection = %connection_id,
            "the engine accepted the event stream and never answered it"
        );
        return Some(Ended::Attach);
    };
    let open = open?;
    let mut body = match open {
        Ok(open) => open.body,
        Err(diagnostic) => {
            tracing::debug!(
                connection = %connection_id,
                code = %diagnostic.code,
                "the engine's event stream did not open"
            );
            return Some(Ended::Attach);
        }
    };

    let opened_at = tokio::time::Instant::now();
    loop {
        // Outside the lock, and for as long as the engine lives. A bounded wait is deliberately
        // absent: a watch waits on its engine for exactly as long as the connection is up, and a
        // deadline here would be the read timeout `HttpRequest::timeout` forbids, one layer out.
        let chunk = tokio::select! {
            chunk = body.next_chunk() => chunk,
            _ = cancel.cancelled() => return None,
        };
        match chunk {
            // The bytes are not this port's — there is no resource cache to refresh. What is being
            // read is whether the stream is still there.
            Ok(Some(_)) => continue,
            Ok(None) | Err(_) => {
                return Some(Ended::Stream {
                    uptime: opened_at.elapsed(),
                });
            }
        }
    }
}

/// The grace window: ping until one answers, or until the attempts run out.
async fn still_answering<F, B, C>(
    connection_id: &str,
    shared: &Arc<Shared<F, B, C>>,
    cancel: &CancellationToken,
) -> bool
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    for attempt in 0..shared.watch.ping_attempts {
        // The gap comes FIRST on every attempt after the first, so the last attempt is followed by a
        // decision rather than by a wait nothing uses.
        if attempt > 0 {
            tokio::select! {
                _ = tokio::time::sleep(shared.watch.ping_delay) => {}
                _ = cancel.cancelled() => return true,
            }
        }
        // **Anything that is not a refusal ends the window.** An engine that answered is obviously
        // still there; so, for this purpose, is a connection that has left the table entirely — the
        // one thing a watcher must never do is report a drop against something somebody else has
        // already taken down. Folded into one question rather than matched into two arms that return
        // the same answer, because the second is a race nothing can arrange and an arm nothing
        // executes is an arm nobody has thought about.
        if !matches!(shared.server.probe(connection_id).await, Some(Err(_))) {
            return true;
        }
    }
    false
}

/// Wait out each scheduled delay and make the attempt, until it succeeds or the machine gives up.
///
/// **An attempt is expensive, and against a real engine it was MEASURED at 51 to 56 seconds.**
/// `Server::reconnect` needs `&mut ConnectionMachine`, and a failing attempt spends
/// `API_READINESS_ATTEMPTS × API_READINESS_WAIT` — ten polls five seconds apart — inside
/// `spawn_service` waiting for a socket that never answers. Driving it live against podman with the
/// engine held down produced attempts 51s, 56s and 51s apart, on a schedule, with nobody having asked.
///
/// **What a minute of that no longer stops is every READ.** `Server`'s lock is split, so a
/// `list_connections`, a snapshot and the one a client is handed the moment it attaches are all
/// answered from the published projection while this runs — measured live, at 0.59 seconds for a
/// client attaching eleven seconds into an attempt. The waiting between attempts stays outside every
/// lock, so what is held is the attempt itself.
///
/// **And what a minute of it no longer stops is another CONNECTION.** The slot this holds is that
/// connection's own (`crate::slots`), so a second engine's `connect` runs alongside, and that engine's
/// own watcher records its drop when it happens rather than a minute later. Named here because this is
/// the caller that made the wait happen unprompted, on a schedule, for as long as an engine stays down.
async fn retry<F, B, C>(
    connection_id: &str,
    shared: &Arc<Shared<F, B, C>>,
    cancel: &CancellationToken,
) -> Attended
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    loop {
        // How long until this cycle's attempt is due — and whether there is still one to make.
        //
        // **The phase and the delay in ONE read**, which is why `Liveness` is one value: a connection
        // that is no longer `reconnecting` has no attempt owed, and asking the two questions
        // separately would answer them about different states. An absent schedule on a `reconnecting`
        // connection means DUE NOW rather than a reason to leave — `schedule_reconnect` sets both in
        // one step, and standing down would strand it in `reconnecting` with nothing left to move it,
        // the one outcome the design names as unacceptable.
        //
        // The early return is what a connection with nothing owed takes. Two things reach it, and only
        // one of them can be arranged from a test. A policy that gives up AT THE DROP — reconnect off,
        // or `maxRetries` already spent — settles at `failed`, so the first cycle finds no schedule and
        // leaves: `a_connection_whose_owner_turned_reconnect_off_is_dropped_once_and_left_alone` is that,
        // and without this read the watcher would reconnect a connection that had given up. A disconnect
        // or a removal BETWEEN two cycles reaches the same line — this read is outside the slot, so a
        // client is free to take the connection down while a watcher is between attempts — but nothing
        // awaits between `reconnect` returning and this read, so scheduling one into that gap needs two
        // threads and is a race rather than an arrangement. What lands in the WIDE window, the delay
        // below, reaches the same conclusion through `reconnect` itself, which has nothing to attempt
        // for a connection that has gone.
        let Some(delay) = shared
            .server
            .liveness(connection_id)
            .filter(|state| state.phase == ConnectionPhase::Reconnecting)
            .map(|state| state.until_retry().unwrap_or_default())
        else {
            return Attended::Done;
        };
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            _ = cancel.cancelled() => return Attended::Done,
        }

        // Published as it happens, by the attempt itself — so nothing is published here. What comes
        // back is this loop's own reading of what became of it.
        let progress = shared
            .server
            .reconnect(connection_id, shared.as_ref())
            .await;
        let settled = progress.last().map(|line| line.phase);
        match settled {
            // Up again. Watch the engine that came back.
            Some(ConnectionPhase::Ready) => return Attended::Again,
            // Another cycle was scheduled: wait it out too.
            Some(ConnectionPhase::Reconnecting) => continue,
            // `failed`, or nothing at all because the connection went away mid-attempt.
            _ => return Attended::Done,
        }
    }
}

fn pushes(progress: Vec<ConnectProgress>) -> Vec<Push> {
    progress
        .into_iter()
        .map(|line| {
            Push::new(Event::Progress {
                progress: Box::new(line),
            })
        })
        .collect()
}
