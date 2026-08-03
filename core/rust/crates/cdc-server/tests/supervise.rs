//! What keeps a live connection live, and what retries it when it is not (, `engineDataService.ts`).
//!
//! **The gap this closes was not a missing test, it was a missing CALLER.** `ConnectionMachine::dropped`
//! had none outside a suite and nothing waited on `next_retry_at`, so `attempt` never left zero,
//! `fail_or_reconnect` always took `enter_failed`, and the whole `reconnecting` phase — the policy, the
//! back-off, the stability window, every line of it tested — could not be reached by any running
//! process. The owner of that waiting is the server, and nothing built it before now.
//!
//! The cycle asserted here is the original's, in its order:
//!
//! 1. the `/events` stream ENDS — an engine stopped, a tunnel broke, a laptop slept
//! 2. the engine is pinged, more than once and with a gap, because that end is occasionally a hiccup
//! 3. only a sustained failure is a drop, and a drop is `machine.dropped`
//! 4. the delay it schedules is waited out, and the attempt is made again
//!
//! Every duration in it is INJECTED ([`WatchSchedule`]), for the reason `Shared::with_handshake_timeout`
//! already gives about the handshake deadline: the production values are six seconds of pinging and a
//! second and a half of grace, which no suite can wait for, and an arm nothing executes is an arm nobody
//! has thought about. The DEFAULTS are asserted against the oracle's own constants, separately.

/// backoff, split out for the 620-line cap — see the module.
///
/// `#[path]`, because a test target rooted at `tests/supervise.rs` resolves a bare `mod`
/// against `tests/` rather than against `tests/supervise/`.
#[path = "supervise/backoff.rs"]
mod backoff;
#[path = "../../cdc-runtime/tests/fakes/mod.rs"]
mod fakes;
#[path = "harness/mod.rs"]
mod harness;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use cdc_runtime::capabilities::http::HttpError;
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectOrigin, ConnectionPhase};
use cdc_runtime::domain::types::user_settings::ReconnectPolicy;
use cdc_server::listen::CLIENT_QUEUE_CAPACITY;
use cdc_server::listen::session::Shared;
use cdc_server::protocol::{Command, Event, Outbound, Request};
use cdc_server::supervise::{
    DROP_PING_ATTEMPTS, DROP_PING_DELAY, EVENTS_ATTACH_LIMIT, EVENTS_MIN_UPTIME, WatchSchedule,
};
use tokio_util::sync::CancellationToken;

use crate::fakes::{FakeClock, FakeHttp, MemoryFs, answered};
use crate::harness::{
    CONNECTION, PATIENCE, dispatched, engine_is_bound, watched_server, watched_server_retrying,
};

/// A schedule with production's SHAPE and none of its patience: still more than one ping, still a gap
/// between them, so the arms a test walks are the arms a server walks.
fn brisk() -> WatchSchedule {
    WatchSchedule {
        ping_attempts: 2,
        ping_delay: Duration::from_millis(5),
        events_min_uptime: Duration::ZERO,
        // Generous, because most tests here are not about the attach: one that HANGS an attach sets
        // its own, and a short bound everywhere else would make a slow CI look like a hung engine.
        events_attach_limit: PATIENCE,
    }
}

/// An engine that is up until it is told to go away, and can be brought back.
///
/// One handle shared by every machine the builder makes, because a reconnect builds its client afresh
/// — an engine that only "went away" for the first machine would be back by the retry, which is the
/// one thing the retry must not be able to assume.
#[derive(Clone, Default)]
struct Engine {
    gone: Arc<AtomicBool>,
    /// How many times `/events` has been asked for. **Counted in the FAKE rather than exposed on
    /// `Server`**, which is the rule `harness::server_on` already states about the clock: an accessor
    /// that exists only for a test is production API that a reader has to explain away.
    attaches: Arc<AtomicUsize>,
}

impl Engine {
    fn stop(&self) {
        self.gone.store(true, Ordering::SeqCst);
    }

    fn start(&self) {
        self.gone.store(false, Ordering::SeqCst);
    }

    fn attaches(&self) -> usize {
        self.attaches.load(Ordering::SeqCst)
    }

    /// A fresh fake over the same handle. `/events` delivers nothing and ends, which is the shape of
    /// an engine letting go — what a watcher reads is the END, never the bytes.
    fn http(&self) -> FakeHttp {
        let gone = Arc::clone(&self.gone);
        let attaches = Arc::clone(&self.attaches);
        FakeHttp::scripted(move |request| {
            if request.path == "/events" {
                attaches.fetch_add(1, Ordering::SeqCst);
            }
            if gone.load(Ordering::SeqCst) {
                return Err(HttpError::Unreachable {
                    endpoint: request.endpoint.clone(),
                    reason: "connection refused".to_string(),
                });
            }
            if request.path == "/_ping" {
                return Ok(answered(200, "OK"));
            }
            Ok(answered(200, "[]"))
        })
    }
}

/// A server whose engine this test controls, watched on a brisk schedule.
fn served(engine: &Engine, watch: WatchSchedule) -> (Arc<TestShared>, CancellationToken) {
    let shutdown = CancellationToken::new();
    let engine = engine.clone();
    let shared = Shared::with_watch_schedule(
        watched_server(engine_is_bound(), move || engine.http(), FakeClock::at(0)),
        shutdown.clone(),
        watch,
    );
    (shared, shutdown)
}

type TestShared = Shared<MemoryFs, harness::WatchedMachines, FakeClock>;

/// Bring the connection up the way a client does, then start watching it.
async fn bring_up(shared: &Arc<TestShared>) {
    let request = Request::new(
        "connect",
        Command::Connect {
            connection_id: CONNECTION.to_string(),
            origin: ConnectOrigin::User,
        },
    );
    let (_, pushes) = dispatched(&shared.server, request).await;
    shared.publish(pushes);
    shared.reconcile().await;
}

/// Wait for a connection to reach `phase`, or fail saying what it reached instead.
async fn settles_at(shared: &Arc<TestShared>, phase: ConnectionPhase) {
    let deadline = tokio::time::Instant::now() + PATIENCE;
    loop {
        let reached = shared.server.liveness(CONNECTION).map(|state| state.phase);
        if reached == Some(phase) {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "waited {PATIENCE:?} for {phase:?} and it is {reached:?}"
        );
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
}

#[test]
fn the_default_schedule_is_the_oracles_own_numbers() {
    // Not decoration: these three are what a real drop is judged by, and every test above chooses
    // something else. `engineDataService.ts` — EVENTS_DROP_PING_ATTEMPTS, EVENTS_DROP_PING_DELAY_MS,
    // EVENTS_MIN_UPTIME_MS.
    assert_eq!(DROP_PING_ATTEMPTS, 3);
    assert_eq!(DROP_PING_DELAY, Duration::from_secs(2));
    assert_eq!(EVENTS_MIN_UPTIME, Duration::from_millis(1_500));
    // `EVENTS_ATTACH_TIMEOUT_MS + 500`, which is what `connectEvents` gives `settleWithin`. The two
    // trees have to give up on an attach at the same moment or one of them watches a connection the
    // other has written off.
    assert_eq!(EVENTS_ATTACH_LIMIT, Duration::from_millis(3_500));

    let default = WatchSchedule::default();
    assert_eq!(default.ping_attempts, DROP_PING_ATTEMPTS);
    assert_eq!(default.ping_delay, DROP_PING_DELAY);
    assert_eq!(default.events_min_uptime, EVENTS_MIN_UPTIME);
    assert_eq!(default.events_attach_limit, EVENTS_ATTACH_LIMIT);
}

#[tokio::test]
async fn a_connection_that_reached_ready_is_watched() {
    let engine = Engine::default();
    let (shared, shutdown) = served(&engine, brisk());

    bring_up(&shared).await;

    assert!(
        shared.watchers.is_watching(CONNECTION),
        "a live connection nothing is watching is a phase nobody is checking"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn a_second_reconcile_does_not_start_a_second_watcher() {
    // Every command reconciles, so this runs constantly. Two watchers on one connection would open
    // two event streams, ping twice per gap, and — the part that actually breaks — both call
    // `dropped` and then both retry, which is two connect attempts racing for one machine.
    let engine = Engine::default();
    let (shared, shutdown) = served(&engine, brisk());
    bring_up(&shared).await;
    let after_first = engine.attaches();

    shared.reconcile().await;
    shared.reconcile().await;
    tokio::time::sleep(Duration::from_millis(30)).await;

    assert!(shared.watchers.is_watching(CONNECTION));
    // The one watcher re-attaches on its own (its stream ends at once), so the count grows — what
    // must NOT happen is a second watcher, which is what the slot claim prevents.
    assert!(
        engine.attaches() >= after_first,
        "the existing watcher kept working"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn an_engine_that_answers_but_will_not_open_a_stream_is_left_alone() {
    // The two failures the ORIGINAL cannot tell apart, and the reason `follow` reports the attach
    // rather than swallowing it: `/events` refusing and the engine being gone are one exception in
    // `connectEvents`, which gives up watching for both. Here the ping decides, and this is the case
    // where it says the engine is perfectly fine — so giving up is right, and declaring a drop would
    // put a healthy connection into `reconnecting` forever.
    let attaches = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&attaches);
    let shutdown = CancellationToken::new();
    let shared = Shared::with_watch_schedule(
        watched_server(
            engine_is_bound(),
            move || {
                let counter = Arc::clone(&counter);
                FakeHttp::scripted(move |request| {
                    if request.path == "/events" {
                        counter.fetch_add(1, Ordering::SeqCst);
                        return Err(HttpError::Unreachable {
                            endpoint: request.endpoint.clone(),
                            reason: "no such route".to_string(),
                        });
                    }
                    Ok(answered(200, "OK"))
                })
            },
            FakeClock::at(0),
        ),
        shutdown.clone(),
        brisk(),
    );
    bring_up(&shared).await;

    tokio::time::sleep(Duration::from_millis(80)).await;

    assert_eq!(
        shared.server.liveness(CONNECTION).map(|state| state.phase),
        Some(ConnectionPhase::Ready),
        "the engine is answering; it is the STREAM that will not open"
    );
    assert_eq!(
        attaches.load(Ordering::SeqCst),
        1,
        "and it gave up rather than retrying the attach in a loop"
    );
    assert!(!shared.watchers.is_watching(CONNECTION));

    // **Giving up has to SURVIVE the next command**, and it did not: `reconcile` runs after every one
    // and asked for a watcher again, so an engine with no `/events` — Apple's `container` is the
    // measured case — paid a fresh attach and its bound per command, forever.
    shared.reconcile().await;
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert_eq!(
        attaches.load(Ordering::SeqCst),
        1,
        "a reconcile re-spawned the watcher that had just given up"
    );

    // And the client is TOLD, which is the half nothing carried: this connection is up and nothing
    // will notice when it stops.
    assert_eq!(
        shared
            .server
            .snapshot()
            .expect("a snapshot")
            .active
            .as_deref()
            .and_then(<[_]>::first)
            .and_then(|it| it.watched),
        Some(false),
        "a working connection nothing is watching must be able to say so"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn a_connection_that_never_came_up_is_not_watched() {
    // Nothing to watch, and starting a watcher anyway would have it fail to attach forever.
    let engine = Engine::default();
    engine.stop();
    let (shared, shutdown) = served(&engine, brisk());

    bring_up(&shared).await;

    assert_eq!(
        shared.server.liveness(CONNECTION).map(|state| state.phase),
        Some(ConnectionPhase::Failed)
    );
    assert!(!shared.watchers.is_watching(CONNECTION));
    shutdown.cancel();
}

#[tokio::test]
async fn an_engine_that_goes_away_puts_its_connection_into_reconnecting() {
    // The whole cycle's first half, and the half that could not happen at all before: the stream
    // ends, the pings fail, and the machine is TOLD — which is the only thing that moves `attempt`
    // off zero and makes the back-off reachable.
    let engine = Engine::default();
    let (shared, shutdown) = served(&engine, brisk());
    bring_up(&shared).await;
    engine.stop();

    settles_at(&shared, ConnectionPhase::Reconnecting).await;

    let state = shared
        .server
        .liveness(CONNECTION)
        .expect("the connection is still held");
    assert!(
        state.next_retry_at.is_some_and(|at| at > state.now),
        "a retry is scheduled in the future: {state:?}"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn the_drop_reaches_every_attached_client_as_progress_and_state() {
    // A drop that only the server knew about would leave every client rendering `ready` for an engine
    // that is gone. It travels the SAME way a command's progress does — `Shared::publish` — because a
    // second fan-out path is how the two come to disagree about what a client has been told.
    let engine = Engine::default();
    let (shared, shutdown) = served(&engine, brisk());
    bring_up(&shared).await;
    let attached = shared.clients.attach("test", CLIENT_QUEUE_CAPACITY);
    engine.stop();

    settles_at(&shared, ConnectionPhase::Reconnecting).await;

    let mut phases = Vec::new();
    let mut snapshots = 0;
    while let Some(frames) = tokio::time::timeout(Duration::from_millis(200), attached.next_batch())
        .await
        .unwrap_or_default()
    {
        for frame in frames {
            match frame {
                Outbound::Pushed(push) => match push.event {
                    Event::Progress { progress } => phases.push(progress.phase),
                    Event::Snapshot { .. } => snapshots += 1,
                    _ => {}
                },
                Outbound::Answer(_) => {}
            }
        }
        if phases.contains(&ConnectionPhase::Reconnecting) && snapshots > 0 {
            break;
        }
    }
    assert!(
        phases.contains(&ConnectionPhase::Reconnecting),
        "the progress line a client renders the countdown from: {phases:?}"
    );
    assert!(snapshots > 0, "and the state that line was narrating");
    shutdown.cancel();
}

#[tokio::test]
async fn the_grace_window_is_the_gaps_between_the_pings_and_not_one_per_ping() {
    // **What makes "six seconds" true of the production constants**: three attempts with the gap
    // BETWEEN them is 2 × 2s, not 3 × 2s and not none at all. All three variants ping the same number
    // of times and reach the same verdict, so only the CLOCK tells them apart — which is why the
    // three mutants of `attempt > 0` survived everything else in this file.
    //
    // A gap per ping would stretch every real drop by a third; no gap at all would delete the grace
    // window outright, and a transient blip would flap a working connection into `reconnecting` —
    // the exact failure `pingUntilAvailable` exists to prevent.
    let engine = Engine::default();
    let watch = WatchSchedule {
        ping_attempts: 3,
        ping_delay: Duration::from_millis(200),
        events_min_uptime: Duration::ZERO,
        events_attach_limit: PATIENCE,
    };
    let (shared, shutdown) = served(&engine, watch);
    bring_up(&shared).await;

    let stopped = tokio::time::Instant::now();
    engine.stop();
    settles_at(&shared, ConnectionPhase::Reconnecting).await;
    let took = stopped.elapsed();

    // Two gaps of 200ms. The bounds are wide on purpose — this runs under a mutation battery, and a
    // scheduler delay is not a defect — but they are far tighter than the variants: one gap is 200ms,
    // three are 600ms, and none is nearly zero.
    assert!(
        took >= Duration::from_millis(300) && took <= Duration::from_millis(550),
        "the grace window should be two 200ms gaps; it took {took:?}"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn a_stream_that_ends_while_the_engine_still_answers_is_not_a_drop() {
    // **The rule the grace window exists for.** A teardown burst can exhaust an engine's listen
    // backlog and take the events stream down for something that clears in seconds; flapping a
    // working connection into `reconnecting` for that is worse than noticing a real drop late. So the
    // end is a TRIGGER and the ping is the VERDICT, and here the verdict says the engine is fine.
    let engine = Engine::default();
    let (shared, shutdown) = served(&engine, brisk());
    bring_up(&shared).await;

    // The fake's `/events` ends the moment it opens, so the watcher re-attaches — repeatedly, which
    // is exactly what the original does when the ping says the engine is there.
    let deadline = tokio::time::Instant::now() + PATIENCE;
    while engine.attaches() < 2 {
        assert!(tokio::time::Instant::now() < deadline, "no re-attach");
        tokio::time::sleep(Duration::from_millis(1)).await;
    }

    assert_eq!(
        shared.server.liveness(CONNECTION).map(|state| state.phase),
        Some(ConnectionPhase::Ready),
        "it never left ready, because the engine never left"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn a_stream_that_ends_almost_at_once_is_not_treated_as_a_drop_either() {
    // `EVENTS_MIN_UPTIME_MS`. A stream that closes immediately never really opened — an engine or a
    // mock with no working `/events` — so it means "no live events here", not "the engine is gone".
    // Without it, such an engine would be declared dropped the instant it came up.
    let engine = Engine::default();
    let watch = WatchSchedule {
        events_min_uptime: Duration::from_secs(30),
        ..brisk()
    };
    let (shared, shutdown) = served(&engine, watch);
    bring_up(&shared).await;

    // Long enough for the whole cycle to have run several times, had it been going to.
    tokio::time::sleep(Duration::from_millis(80)).await;

    assert_eq!(
        shared.server.liveness(CONNECTION).map(|state| state.phase),
        Some(ConnectionPhase::Ready),
        "an engine with no usable /events is left alone, not declared dead"
    );
    // And it gave up rather than re-attaching, which is the other half of the rule: without it, an
    // engine whose stream ends on open is an attach loop for as long as the connection is up.
    assert_eq!(engine.attaches(), 1);
    assert!(!shared.watchers.is_watching(CONNECTION));
    shutdown.cancel();
}

#[tokio::test]
async fn a_stream_that_ended_at_once_because_the_engine_died_is_still_a_drop() {
    // **The other half of `EVENTS_MIN_UPTIME`, and the hole the oracle has here.** A stream can close
    // inside the uptime window for two unrelated reasons — the engine has no usable `/events` route, or
    // the engine has just GONE — and `connectEvents` reads the first for both, because it returns
    // before it pings (`engineDataService.ts:995`). That is the same mistake `follow` already refuses
    // to make about a failed ATTACH, told apart by the same thing: the ping.
    //
    // Seen live, in the kill-loop drive: the connection reconnected, re-attached, had its stream cut
    // half a second later by the next kill, and then rendered `ready` over a dead engine for two
    // minutes. Here the engine dies AS the stream opens, so the attach succeeded (it is not
    // `Ended::Attach`) and the uptime is far inside the window.
    let attaches = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&attaches);
    let shutdown = CancellationToken::new();
    let shared = Shared::with_watch_schedule(
        watched_server(
            engine_is_bound(),
            move || {
                let counter = Arc::clone(&counter);
                let died = Arc::new(AtomicBool::new(false));
                FakeHttp::scripted(move |request| {
                    if request.path == "/events" {
                        counter.fetch_add(1, Ordering::SeqCst);
                        // It opened. Nothing is delivered and the body ends at once — and the engine
                        // is gone by the time anyone can ask.
                        died.store(true, Ordering::SeqCst);
                        return Ok(answered(200, ""));
                    }
                    if died.load(Ordering::SeqCst) {
                        return Err(HttpError::Unreachable {
                            endpoint: request.endpoint.clone(),
                            reason: "connection refused".to_string(),
                        });
                    }
                    Ok(answered(200, "OK"))
                })
            },
            FakeClock::at(0),
        ),
        shutdown.clone(),
        WatchSchedule {
            events_min_uptime: Duration::from_secs(30),
            ..brisk()
        },
    );
    bring_up(&shared).await;

    settles_at(&shared, ConnectionPhase::Reconnecting).await;

    assert_eq!(
        attaches.load(Ordering::SeqCst),
        1,
        "it did not re-attach in a loop; the ping is what decided"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn the_scheduled_delay_is_waited_out_and_the_attempt_is_made_again() {
    // The second half of the cycle, and the half `next_retry_at`'s own doc asks for: "for the caller
    // that owns the waiting". The engine comes back, so the retry succeeds and the connection is up
    // again without anybody having issued a command.
    let engine = Engine::default();
    let (shared, shutdown) = served(&engine, brisk());
    bring_up(&shared).await;
    engine.stop();
    settles_at(&shared, ConnectionPhase::Reconnecting).await;

    engine.start();

    settles_at(&shared, ConnectionPhase::Ready).await;
    shutdown.cancel();
}

#[tokio::test]
async fn a_retry_that_fails_schedules_the_next_one_rather_than_stopping() {
    // **The back-off actually backing off**, which needs more than one cycle to mean anything: the
    // engine stays gone, so the retry fails, and what must happen is another scheduled attempt rather
    // than a watcher that gives up after one. `attempt` is read from the SNAPSHOT because that is the
    // number a client renders beside the countdown.
    let engine = Engine::default();
    let (shared, shutdown) = served(&engine, brisk());
    bring_up(&shared).await;
    engine.stop();

    // **Three, not two.** Attempt 2 is what the FIRST retry schedules, so a watcher that stopped after
    // one cycle would reach it and look correct — deleting the `Reconnecting => continue` arm survives
    // an assertion of 2. Only a third attempt proves the loop went round.
    let deadline = tokio::time::Instant::now() + PATIENCE;
    loop {
        let reached = attempt(&shared).await;
        if reached.is_some_and(|reached| reached >= 3) {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "waited {PATIENCE:?} for a third attempt and it is {reached:?}"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    shutdown.cancel();
}

#[tokio::test]
async fn a_reconnect_that_runs_out_of_retries_gives_up_and_says_failed() {
    // `maxRetries` — "reconnect gave up": `failed`, never an endless `reconnecting`. the design names a
    // connection stuck in `reconnecting` forever as the failure mode to avoid, and this is the arm
    // that avoids it. One retry allowed, so the second cycle is the one that ends it.
    let engine = Engine::default();
    let shutdown = CancellationToken::new();
    let watched = engine.clone();
    let shared = Shared::with_watch_schedule(
        watched_server_retrying(
            engine_is_bound(),
            move || watched.http(),
            FakeClock::at(0),
            Some(ReconnectPolicy {
                enabled: true,
                factor: None,
                initial_ms: None,
                max_ms: None,
                max_retries: Some(1),
            }),
        ),
        shutdown.clone(),
        brisk(),
    );
    bring_up(&shared).await;
    engine.stop();

    settles_at(&shared, ConnectionPhase::Failed).await;

    assert!(
        !shared.watchers.is_watching(CONNECTION),
        "and the watcher stood down with it, rather than retrying something that gave up"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn a_connection_whose_owner_turned_reconnect_off_is_dropped_once_and_left_alone() {
    // **The early return at the top of the retry cycle**, which is the other way a watch ends: not
    // "the retries ran out" but "there was never one owed". With reconnect off the drop itself settles
    // at `failed`, so the watcher arrives at its cycle with nothing scheduled — and it has to read
    // that BEFORE it waits, or a connection nobody will ever retry keeps a task waking to find nothing.
    //
    // **The same line is what a disconnect between two cycles takes, and that one cannot be timed from
    // a test**: nothing awaits between `dropped` returning and this read, nor between `reconnect`
    // returning `reconnecting` and the next one, so no other task can be scheduled into the gap. A
    // policy that says no from the start reaches the line by the front door instead.
    let engine = Engine::default();
    let shutdown = CancellationToken::new();
    let watched = engine.clone();
    let shared = Shared::with_watch_schedule(
        watched_server_retrying(
            engine_is_bound(),
            move || watched.http(),
            FakeClock::at(0),
            Some(ReconnectPolicy {
                enabled: false,
                factor: None,
                initial_ms: None,
                max_ms: None,
                max_retries: None,
            }),
        ),
        shutdown.clone(),
        brisk(),
    );
    bring_up(&shared).await;
    // Attached AFTER the connect, so what arrives below is what the WATCHER produced and nothing else.
    let attached = shared.clients.attach("test", CLIENT_QUEUE_CAPACITY);
    engine.stop();

    settles_at(&shared, ConnectionPhase::Failed).await;

    // **The trace is the observable, because a trace is never superseded** — unread STATE is, so a
    // count of snapshots could not tell an attempt that happened from one that did not. Drained to
    // quiet, so an attempt made a moment later still lands in it.
    let mut phases = Vec::new();
    while let Some(frames) = tokio::time::timeout(Duration::from_millis(200), attached.next_batch())
        .await
        .unwrap_or_default()
    {
        for frame in frames {
            if let Outbound::Pushed(push) = frame
                && let Event::Progress { progress } = push.event
            {
                phases.push(progress.phase);
            }
        }
    }
    assert_eq!(
        phases,
        vec![ConnectionPhase::Failed],
        "the drop, and NOTHING after it. A watcher that read the schedule after waiting rather than \
         before would have attempted a reconnect here, and every one of its lines would be in this \
         list — `starting`, its sub-steps, and a second `failed`"
    );
    assert!(
        !shared.watchers.is_watching(CONNECTION),
        "and it stood down rather than waking to find nothing, for as long as the process runs"
    );
    shutdown.cancel();
}

/// A server whose back-off delay is long enough for a test to act DURING it.
///
/// The two races below both need the watcher parked mid-cycle, and that window is a few hundred
/// milliseconds under the default policy — which is a flake rather than a test. `initialMs` is the
/// honest lever: it is the user's own setting, and it moves the same delay the watcher waits.
fn parked(engine: &Engine, initial_ms: i64) -> (Arc<TestShared>, CancellationToken) {
    let shutdown = CancellationToken::new();
    let engine = engine.clone();
    let shared = Shared::with_watch_schedule(
        watched_server_retrying(
            engine_is_bound(),
            move || engine.http(),
            FakeClock::at(0),
            Some(ReconnectPolicy {
                enabled: true,
                factor: None,
                initial_ms: Some(initial_ms),
                max_ms: None,
                max_retries: None,
            }),
        ),
        shutdown.clone(),
        brisk(),
    );
    (shared, shutdown)
}

/// The attempt number a client would render, read the way a client gets it.
async fn attempt(shared: &Arc<TestShared>) -> Option<i64> {
    shared
        .server
        .snapshot()
        .ok()
        .and_then(|snapshot| snapshot.active)
        .and_then(|active| active.first().and_then(|info| info.attempt))
}
