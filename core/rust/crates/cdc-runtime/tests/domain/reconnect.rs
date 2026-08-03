//! Reconnect policy resolution and the back-off schedule.
//!
//! The oracle is `engineDataService.ts:resolveReconnectPolicy` and `backoffDelay`. Every number
//! here comes from there, including the two that look arbitrary: the 250ms floor and the fact that
//! `maxRetries` is compared against the UPCOMING attempt, so `maxRetries: 3` schedules three retries
//! and gives up on the fourth.

use cdc_runtime::domain::reconnect::{
    BackoffSchedule, DeterministicBackoff, MINIMUM_DELAY_MS, STABLE_MS, resolve,
};
use cdc_runtime::domain::types::user_settings::ReconnectPolicy;

fn global(enabled: bool) -> ReconnectPolicy {
    ReconnectPolicy {
        enabled,
        factor: None,
        initial_ms: None,
        max_ms: None,
        max_retries: None,
    }
}

#[test]
fn nothing_configured_means_enabled_with_a_one_to_thirty_second_schedule() {
    let policy = resolve(None, None);

    assert!(
        policy.enabled,
        "reconnect defaults to ON, as the oracle does"
    );
    assert_eq!(policy.initial_ms, 1_000);
    assert_eq!(policy.max_ms, 30_000);
    assert_eq!(policy.factor, 2.0);
    assert_eq!(policy.max_retries, None);
}

#[test]
fn the_schedule_doubles_from_one_second_and_saturates_at_thirty() {
    let policy = resolve(None, None);

    let schedule: Vec<u64> = (1..=8)
        .map(|attempt| policy.base_delay_ms(attempt))
        .collect();

    // 1s, 2s, 4s, 8s, 16s, then the cap — not 32s.
    assert_eq!(
        schedule,
        vec![1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]
    );
}

#[test]
fn the_per_connection_flag_overrides_the_global_one_in_both_directions() {
    // `perConnection ?? global?.enabled ?? true` — the override wins even when it says NO and the
    // global says yes, which is the case a naive `||` gets wrong.
    assert!(!resolve(Some(false), Some(&global(true))).enabled);
    assert!(resolve(Some(true), Some(&global(false))).enabled);
    assert!(!resolve(None, Some(&global(false))).enabled);
}

#[test]
fn a_global_policy_that_sets_only_enabled_keeps_the_default_timings() {
    let policy = resolve(None, Some(&global(true)));

    assert_eq!(
        (policy.initial_ms, policy.max_ms, policy.factor),
        (1_000, 30_000, 2.0),
        "each field falls back on its own; a partially-tuned policy is not all-or-nothing"
    );
}

#[test]
fn a_tuned_policy_is_honoured_but_never_retries_faster_than_the_floor() {
    let tuned = ReconnectPolicy {
        enabled: true,
        factor: Some(3.0),
        initial_ms: Some(100),
        max_ms: Some(1_000),
        max_retries: Some(4),
    };
    let policy = resolve(None, Some(&tuned));

    assert_eq!(policy.max_retries, Some(4));
    // 100ms is below the floor the oracle imposes, so the first retry still waits 250ms.
    assert_eq!(policy.base_delay_ms(1), MINIMUM_DELAY_MS);
    assert_eq!(policy.base_delay_ms(2), 300);
    assert_eq!(policy.base_delay_ms(3), 900);
    assert_eq!(policy.base_delay_ms(4), 1_000, "capped by maxMs");
}

#[test]
fn a_nonsensical_policy_still_produces_a_usable_delay() {
    // The schema types these as plain integers, so a hand-edited settings file can carry a negative
    // one. It must not panic, wrap, or busy-loop.
    let broken = ReconnectPolicy {
        enabled: true,
        factor: Some(-1.0),
        initial_ms: Some(-5_000),
        max_ms: Some(-1),
        max_retries: Some(-2),
    };
    let policy = resolve(None, Some(&broken));

    assert_eq!(policy.base_delay_ms(1), MINIMUM_DELAY_MS);
    assert_eq!(policy.base_delay_ms(9), MINIMUM_DELAY_MS);
    assert!(
        policy.exhausted(1),
        "a negative maxRetries cannot be satisfied by any attempt"
    );
}

#[test]
fn max_retries_is_compared_against_the_upcoming_attempt() {
    let policy = resolve(
        None,
        Some(&ReconnectPolicy {
            enabled: true,
            factor: None,
            initial_ms: None,
            max_ms: None,
            max_retries: Some(3),
        }),
    );

    assert!(!policy.exhausted(1));
    assert!(!policy.exhausted(3), "the third retry is still allowed");
    assert!(policy.exhausted(4), "the fourth is one too many");
}

#[test]
fn an_unlimited_policy_is_never_exhausted_and_a_disabled_one_always_is() {
    assert!(!resolve(None, None).exhausted(9_999));
    assert!(resolve(Some(false), None).exhausted(1));
}

#[test]
fn the_deterministic_schedule_is_the_base_delay_itself() {
    // What the corpus replays. The shipping jitter lives in `cdc-runtime`, because randomness is not
    // allowed in the domain and a jittered schedule cannot be pinned by a transcript.
    let policy = resolve(None, None);
    let mut backoff = DeterministicBackoff;

    assert_eq!(backoff.delay_ms(1, &policy), 1_000);
    assert_eq!(backoff.delay_ms(3, &policy), 4_000);
}

#[test]
fn a_connection_counts_as_stable_after_thirty_seconds() {
    assert_eq!(
        STABLE_MS, 30_000,
        "the oracle's RECONNECT_STABLE_MS — a flapping engine must keep backing off"
    );
}
