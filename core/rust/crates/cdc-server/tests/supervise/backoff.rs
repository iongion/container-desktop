//! The back-off a client is SHOWN, and what interrupts it.
//!
//! Split from the parent for the 620-line cap; the fixtures stay there and arrive with
//! `use super::*`.

use super::*;
#[tokio::test]
async fn the_delay_a_client_is_shown_is_the_delay_that_is_actually_waited() {
    // **A supervisor that retried immediately would pass every other test in this file**, because they
    // all assert an eventual state and every one of them arrives sooner if nothing waits. What it
    // would cost is the whole point of the back-off: `retry in 0.4s` published to a client while the
    // server hammers the engine as fast as it can fail — the retry storm, wearing the countdown that
    // was supposed to prevent it. Caught by `until_retry -> None` and `-> Some(0)` surviving.
    let engine = Engine::default();
    let (shared, shutdown) = parked(&engine, 400);
    bring_up(&shared).await;
    engine.stop();
    settles_at(&shared, ConnectionPhase::Reconnecting).await;
    assert_eq!(attempt(&shared).await, Some(1));

    // Well inside the 400ms this connection published. Nothing may have been attempted yet.
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        attempt(&shared).await,
        Some(1),
        "the attempt fired before its delay had passed"
    );

    // And well past it, so this is a test of the WAIT and not of a watcher that never retries.
    let deadline = tokio::time::Instant::now() + PATIENCE;
    while attempt(&shared).await == Some(1) {
        assert!(
            tokio::time::Instant::now() < deadline,
            "the delay passed and nothing was attempted"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    shutdown.cancel();
}

#[tokio::test]
async fn a_disconnect_during_the_backoff_delay_stops_the_retry() {
    // `userDisconnected`, in the window where the reconcile that cancels the watcher has not run yet.
    // The check that matters is the watcher's OWN, taken under the lock the instant before it would
    // reconnect: without it, a connection the user turned off comes back up from a timer nobody can
    // see, which is the worst kind of bug to be told about.
    let engine = Engine::default();
    let (shared, shutdown) = parked(&engine, 400);
    bring_up(&shared).await;
    engine.stop();
    settles_at(&shared, ConnectionPhase::Reconnecting).await;

    // The real command, and then deliberately NO reconcile: a session would cancel the watcher a
    // moment later, and the arm under test is the one that fires before that cancellation lands.
    let request = Request::new(
        "off",
        Command::Disconnect {
            connection_id: CONNECTION.to_string(),
        },
    );
    dispatched(&shared.server, request).await;
    // A healthy engine sitting there, so the retry WOULD succeed if it ran.
    engine.start();
    // **Past the delay**, which is the whole point: the watcher has to WAKE and decide. Asserting
    // while it is still asleep passes against a watcher that reconnects everything it ever held.
    tokio::time::sleep(Duration::from_millis(700)).await;

    assert_eq!(
        shared.server.liveness(CONNECTION),
        None,
        "it stayed off, with a healthy engine there and a delay that had expired"
    );
    assert!(
        !shared.watchers.is_watching(CONNECTION),
        "and it stood down"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn a_hand_connect_during_the_backoff_delay_leaves_it_watched() {
    // The other side of the same window, and a hole worth naming: the `reconcile` that runs for that
    // hand-issued `connect` finds this watcher's slot already claimed and skips it. So if the parked
    // watcher stood down on seeing `ready`, the connection would end up UP and unwatched — until some
    // unrelated command happened to reconcile. It goes back to watching instead.
    let engine = Engine::default();
    let (shared, shutdown) = parked(&engine, 400);
    bring_up(&shared).await;
    engine.stop();
    settles_at(&shared, ConnectionPhase::Reconnecting).await;

    engine.start();
    bring_up(&shared).await;
    settles_at(&shared, ConnectionPhase::Ready).await;

    // **Past the delay the old watcher is parked on**, so it wakes and decides. Before this wait the
    // assertion below holds trivially — the sleeping watcher still holds the slot — which is exactly
    // how a watcher that stood down here would have looked correct.
    tokio::time::sleep(Duration::from_millis(700)).await;

    assert!(
        shared.watchers.is_watching(CONNECTION),
        "a connection that came back up by hand is still watched"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn a_user_disconnect_stops_the_watch_rather_than_racing_it() {
    // `userDisconnected`. A watcher that outlived the command would reconnect a connection the user
    // had just turned off — and it would do it from a timer nobody could see.
    let engine = Engine::default();
    let (shared, shutdown) = served(&engine, brisk());
    bring_up(&shared).await;
    assert!(shared.watchers.is_watching(CONNECTION));

    let request = Request::new(
        "off",
        Command::Disconnect {
            connection_id: CONNECTION.to_string(),
        },
    );
    let (_, pushes) = dispatched(&shared.server, request).await;
    shared.publish(pushes);
    shared.reconcile().await;

    assert!(!shared.watchers.is_watching(CONNECTION));
    engine.stop();
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert_eq!(
        shared.server.liveness(CONNECTION),
        None,
        "and it stayed off"
    );
    shutdown.cancel();
}

#[tokio::test]
async fn shutting_the_process_down_stops_every_watch() {
    // The watchers are on the shared `TaskTracker`, which a graceful shutdown WAITS for. One that
    // did not answer the shutdown token would hang the process on the way out — and both shutdown
    // paths (the listener's and the terminal's) would hang the same way.
    let engine = Engine::default();
    let (shared, shutdown) = served(&engine, brisk());
    bring_up(&shared).await;
    assert!(shared.watchers.is_watching(CONNECTION));

    shutdown.cancel();
    shared.tasks.close();

    tokio::time::timeout(PATIENCE, shared.tasks.wait())
        .await
        .expect("every watcher answered the shutdown token");
}

#[tokio::test]
async fn an_engine_that_accepts_the_event_stream_and_never_answers_it_stands_the_watcher_down() {
    // **Measured, not imagined.** Apple's `container` through socktainer 1.2.0 routes `/events` — a
    // bogus path there answers 404 — and then writes nothing: no status line, no headers, zero bytes,
    // held for 25 seconds across a real container event, while `/_ping` answers 200 the whole time.
    //
    // Without a bound on the ATTACH the watcher parks on that future for the life of the process: no
    // chunk, no error, no end, so `follow` never yields and the "answering but will not stream" arm —
    // written for exactly this engine — is unreachable. The connection renders `ready`, which it is,
    // and nothing is watching it, which nobody can tell.
    let shutdown = CancellationToken::new();
    let watch = WatchSchedule {
        events_attach_limit: Duration::from_millis(40),
        ..brisk()
    };
    let shared = Shared::with_watch_schedule(
        watched_server(engine_is_bound(), FakeHttp::silent_stream, FakeClock::at(0)),
        shutdown.clone(),
        watch,
    );

    bring_up(&shared).await;
    // Long enough for the bound to elapse and the verdict to be reached, and far short of PATIENCE.
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert!(
        !shared.watchers.is_watching(CONNECTION),
        "the watcher gave up rather than parking on an attach that will never answer"
    );
    assert_eq!(
        shared.server.liveness(CONNECTION).map(|state| state.phase),
        Some(ConnectionPhase::Ready),
        "and the connection is left alone: it IS ready — the engine answers everything except this"
    );
    shutdown.cancel();
}
