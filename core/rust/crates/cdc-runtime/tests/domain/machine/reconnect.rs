//! Reconnect, cancellation, and the state a server reads (,-5).
//!
//! The other half of `machine.rs`, split from it to stay under the line ceiling.
//!
//! **The machine no longer sleeps, and this file is where that shows.** A back-off used to be a
//! `Step::Sleep` a harness answered by moving a fake clock; now the machine publishes `next_retry_at`
//! and RETURNS, so the schedule is a pure function of the attempt count and the waiting belongs to the
//! caller. `Harness::follow_retries` is that caller, and the delays it records are exactly what the
//! old transcript recorded.
//!
//! **Cancellation is DROPPING the `connect` future**, so the tests for it drop one — mid-flight,
//! while the fake is still holding — and then assert on what the capability was left holding.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use crate::fakes::FakeCommand;
use crate::harness::{Harness, engine_is_healthy, healthy_podman, linux, options, podman};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::reconnect::STABLE_MS;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::resource_sync_protocol::{
    ConnectOrigin, ConnectProgress, ConnectionPhase, ConnectionStartingStep,
};
use cdc_runtime::domain::types::user_settings::ReconnectPolicy;

/// A Podman that answers `system info` from a script: the nth call decides.
///
/// Only the socket read is counted, because that is the one probe an attempt reaches last — the
/// program and its version are found every time, so a "the engine came back on the fourth attempt"
/// schedule is expressed by that call alone.
fn engine_that_fails(failing: std::ops::RangeInclusive<u32>) -> FakeCommand {
    let calls = Arc::new(AtomicU32::new(0));
    FakeCommand::scripted(move |argv| match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
        [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => {
            let call = calls.fetch_add(1, Ordering::SeqCst) + 1;
            if failing.contains(&call) {
                CommandExecutionResult::failed(125, "Cannot connect to Podman")
            } else {
                CommandExecutionResult::ok(
                    r#"{"host":{"remoteSocket":{"path":"/run/podman.sock","exists":true}}}"#,
                )
            }
        }
    })
}

#[tokio::test]
async fn a_manual_reconnect_of_a_failed_connection_starts_no_back_off_cycle() {
    // Only the drop of a LIVE connection auto-reconnects (`maybeContinueReconnect`). A connection
    // that never came up is retried by the user, not by a schedule.
    let mut harness = Harness::over(
        options(podman(), false),
        linux(None),
        engine_that_fails(1..=4),
    );

    harness.connect(0).await;
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);

    harness.clock.set(1);
    let again = harness.machine.connect(ConnectOrigin::User, None).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert!(!again.is_empty(), "the attempt was made");
    assert_eq!(
        harness.machine.next_retry_at(),
        None,
        "and nothing was scheduled"
    );
}

#[tokio::test]
async fn a_live_connection_that_drops_retries_on_the_documented_schedule() {
    // The initial connect succeeds, the first two retries fail, the third comes back — so the
    // schedule waits 1s, 2s and 4s and no more.
    let mut harness = Harness::over(
        options(podman(), false),
        linux(None),
        engine_that_fails(2..=3),
    );
    harness.connect(0).await;
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);

    let dropped = harness.dropped(0, DiagnosticCode::ApiUnreachable).await;
    let cascade = harness.follow_retries(0).await;

    assert_eq!(
        cascade.delays,
        vec![1_000, 2_000, 4_000],
        "1s, 2s, 4s — doubling, and never a fourth wait because the fourth attempt succeeded"
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    let mut published = dropped.progress;
    published.extend(cascade.progress);
    let reconnecting: Vec<&ConnectProgress> = published
        .iter()
        .filter(|line| line.phase == ConnectionPhase::Reconnecting)
        .collect();
    assert_eq!(
        reconnecting
            .iter()
            .map(|line| (line.attempt, line.next_retry_at))
            .collect::<Vec<_>>(),
        vec![
            (Some(1), Some(1_000)),
            (Some(2), Some(3_000)),
            (Some(3), Some(7_000))
        ],
        "each line carries its own attempt and when it fires, so a client needs one stream"
    );
    assert!(
        reconnecting
            .iter()
            .all(|line| line.origin == Some(ConnectOrigin::Reconnect))
    );
}

#[tokio::test]
async fn an_exhausted_policy_reaches_failed_rather_than_reconnecting_forever() {
    let policy = ReconnectPolicy {
        enabled: true,
        factor: None,
        initial_ms: None,
        max_ms: None,
        max_retries: Some(2),
    };
    let mut harness = Harness::over(
        options(podman(), false),
        linux(Some(policy)),
        engine_that_fails(2..=u32::MAX),
    );
    harness.connect(0).await;
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);

    harness.dropped(0, DiagnosticCode::ApiUnreachable).await;
    let cascade = harness.follow_retries(0).await;

    assert_eq!(
        cascade.delays,
        vec![1_000, 2_000],
        "two retries, then it stops"
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    let runtime = harness.machine.runtime_info();
    assert_eq!(runtime.attempt, None, "the counter is cleared on giving up");
    assert_eq!(runtime.next_retry_at, None);
    assert_eq!(runtime.reconnecting, None);
}

#[tokio::test]
async fn a_connection_with_reconnect_switched_off_fails_on_the_first_drop() {
    let mut disabled = podman();
    disabled.settings.api.auto_reconnect = Some(false);
    let mut harness = Harness::new(
        options(disabled, false),
        // Enabled globally: the per-connection NO must still win.
        linux(Some(ReconnectPolicy {
            enabled: true,
            factor: None,
            initial_ms: None,
            max_ms: None,
            max_retries: None,
        })),
        engine_is_healthy,
    );
    harness.connect(0).await;

    harness.dropped(0, DiagnosticCode::ApiUnreachable).await;

    assert_eq!(harness.machine.next_retry_at(), None);
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
}

#[tokio::test]
async fn a_connection_that_stayed_up_starts_its_next_back_off_from_the_beginning() {
    let mut harness = healthy_podman(false);
    harness.connect(0).await;

    // Drop once (attempt 1, 1s), come back, stay up past the stability window, drop again.
    harness.dropped(0, DiagnosticCode::ApiUnreachable).await;
    let first = harness.follow_retries(0).await;
    assert_eq!(first.delays, vec![1_000]);
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);

    let later = 1_000 + STABLE_MS;
    harness.dropped(later, DiagnosticCode::ApiUnreachable).await;
    let second = harness.follow_retries(later).await;

    assert_eq!(
        second.delays,
        vec![1_000],
        "a connection that proved itself is forgiven its attempt count"
    );
}

#[tokio::test]
async fn a_flapping_connection_keeps_backing_off_instead_of_resetting() {
    let mut harness = healthy_podman(false);
    harness.connect(0).await;

    harness.dropped(0, DiagnosticCode::ApiUnreachable).await;
    let first = harness.follow_retries(0).await;
    assert_eq!(first.delays, vec![1_000]);

    // Back up, but it drops again almost immediately — well inside the stability window.
    harness.dropped(1_500, DiagnosticCode::ApiUnreachable).await;
    let second = harness.follow_retries(1_500).await;

    assert_eq!(
        second.delays,
        vec![2_000],
        "the counter carries over, so a flapping engine is not retried in a tight loop"
    );
}

#[tokio::test]
async fn a_drop_that_arrives_when_nothing_is_live_is_ignored() {
    // A drop reported while starting or already retrying is the same failure arriving twice.
    let mut harness = healthy_podman(false);

    let log = harness.dropped(0, DiagnosticCode::ApiUnreachable).await;

    assert!(log.progress.is_empty());
    assert_eq!(harness.machine.next_retry_at(), None);
    assert_eq!(harness.machine.phase(), ConnectionPhase::Idle);
}

#[tokio::test]
async fn the_runtime_info_is_projected_from_state_rather_than_assembled() {
    let mut harness = healthy_podman(false);
    harness.connect(0).await;

    let ready = harness.machine.runtime_info();
    assert_eq!(ready.id, "host.default.podman.native");
    assert_eq!(ready.name, "podman-native");
    assert_eq!(ready.phase, ConnectionPhase::Ready);
    assert!(ready.running);
    assert_eq!(ready.uri.as_deref(), Some("/run/podman.sock"));
    assert_eq!(ready.version.as_deref(), Some("5.6.2"));
    assert_eq!(ready.relay, None, "a native host has no relay");
    assert_eq!(ready.scope, None);
    assert_eq!(ready.error, None);
    assert_eq!(
        (ready.reconnecting, ready.attempt, ready.next_retry_at),
        (None, None, None),
        "a live connection has no retry in flight"
    );

    harness.dropped(4_000, DiagnosticCode::ApiUnreachable).await;

    let reconnecting = harness.machine.runtime_info();
    assert_eq!(reconnecting.phase, ConnectionPhase::Reconnecting);
    assert!(!reconnecting.running);
    assert_eq!(reconnecting.reconnecting, Some(true));
    assert_eq!(reconnecting.attempt, Some(1));
    assert_eq!(reconnecting.next_retry_at, Some(5_000));
    assert_eq!(
        reconnecting.error.map(|it| it.code),
        Some(DiagnosticCode::ApiUnreachable),
        "why it is retrying, as a code — the client renders the prose"
    );
    assert_eq!(
        reconnecting.uri.as_deref(),
        Some("/run/podman.sock"),
        "the resolved socket survives a drop; the projection reads state, it does not guess"
    );
}

/// A connection whose every operation takes a second, so an attempt can be interrupted part-way.
///
/// Under `start_paused` the second costs no real time — the runtime advances the clock the moment
/// everything is idle, which is what makes a cancellation test deterministic instead of a race.
fn slow_podman(start_api: bool) -> Harness {
    Harness::over(
        options(podman(), start_api),
        linux(None),
        FakeCommand::answering(engine_is_healthy).holding(Duration::from_secs(1)),
    )
}

#[tokio::test(start_paused = true)]
async fn an_attempt_whose_future_is_dropped_leaves_its_service_to_the_disconnect() {
    // The claim the machine's teardown is built on: a `connect` future dropped BETWEEN spawning a
    // service and recording it would leave a flag false while the capability holds a live child, so
    // teardown addresses the service by the connection's NAME and not by anything this attempt wrote
    // down. The fake records a spawn only after its wait, which reproduces exactly that window.
    let mut harness = slow_podman(true);
    {
        let attempt = harness.machine.connect(ConnectOrigin::Bootstrap, None);
        tokio::pin!(attempt);
        assert!(
            tokio::time::timeout(Duration::from_millis(3_500), &mut attempt)
                .await
                .is_err(),
            "the attempt must still be in flight when it is dropped"
        );
    }
    assert_eq!(
        harness.machine.phase(),
        ConnectionPhase::Starting,
        "nothing settled it — the future was abandoned"
    );
    assert_eq!(
        harness.machine.starting_step(),
        Some(ConnectionStartingStep::StartingApi),
        "and the sub-step still says where it was, which is what a server publishes"
    );
    assert!(
        harness.spawned().is_empty(),
        "the spawn never completed, so nothing recorded it: {:?}",
        harness.spawned()
    );

    let log = harness.disconnect(4_000).await;

    assert_eq!(
        harness.killed(),
        vec!["api:host.default.podman.native".to_string()],
        "the service is torn down by name, whether or not the attempt lived to record it"
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Idle);
    assert_eq!(log.phases(), vec![ConnectionPhase::Idle]);
}

#[tokio::test(start_paused = true)]
async fn an_attempt_abandoned_mid_flight_can_be_started_again() {
    // A dropped future leaves the phase saying `starting` with nothing starting. Refusing the next
    // `connect` on the strength of that would strand the connection in a phase no input can leave —
    // and it is a phase clients are shown. The next attempt tears down what the abandoned one left
    // and runs, which is the only answer that keeps the published phase true.
    let mut harness = slow_podman(true);
    {
        let attempt = harness.machine.connect(ConnectOrigin::Bootstrap, None);
        tokio::pin!(attempt);
        let _ = tokio::time::timeout(Duration::from_millis(3_500), &mut attempt).await;
    }
    assert_eq!(harness.machine.phase(), ConnectionPhase::Starting);

    harness.clock.set(10_000);
    let again = harness.machine.connect(ConnectOrigin::User, None).await;

    assert!(!again.is_empty(), "the second attempt ran");
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert_eq!(
        harness.killed(),
        vec!["api:host.default.podman.native".to_string()],
        "and it stopped what the abandoned attempt had left running before opening its own"
    );
}

#[tokio::test]
async fn a_disconnect_cancels_a_pending_retry() {
    let mut harness = healthy_podman(false);
    harness.connect(0).await;
    harness.dropped(0, DiagnosticCode::ApiUnreachable).await;
    assert_eq!(harness.machine.phase(), ConnectionPhase::Reconnecting);
    assert_eq!(harness.machine.next_retry_at(), Some(1_000));
    assert_eq!(harness.machine.attempt(), 1, "one retry is owed");

    harness.disconnect(500).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Idle);
    assert_eq!(
        harness.machine.runtime_info().next_retry_at,
        None,
        "the retry the caller was waiting for is off the schedule"
    );
    assert_eq!(harness.machine.attempt(), 0);
}
