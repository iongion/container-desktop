//! The jitter a LIVE scheduler adds to the domain's ceiling.
//!
//! The oracle is `engineDataService.ts:backoffDelay`, and it is three tokens long:
//! `Math.max(250, Math.floor(Math.random() * base))`. What matters about it is not the arithmetic but
//! why it is there — a fleet of connections dropped by one event (the internet goes down, a VPN
//! reconnects, a laptop wakes) all compute the SAME ceiling from the same policy, so an unjittered
//! schedule sends every one of them at the engine in the same millisecond, and again at the next.
//!
//! The randomness is INJECTED, which is what makes every line below an equality rather than a range.
//! `cdc_runtime::domain::reconnect` computes the ceiling and says why it cannot draw: a pure domain
//! has no entropy, and a schedule pinned by a transcript cannot have any either.

use cdc_runtime::domain::reconnect::{BackoffSchedule, MINIMUM_DELAY_MS, resolve};
use cdc_runtime_host_native::backoff::JitteredBackoff;

/// A schedule whose draws are known, so a delay can be asserted exactly. Repeats the last one, so a
/// test may ask for more delays than it wrote draws.
fn drawing(units: &[f64]) -> JitteredBackoff {
    let units = units.to_vec();
    let mut next = 0;
    JitteredBackoff::new(move || {
        let unit = units[next.min(units.len() - 1)];
        next += 1;
        unit
    })
}

#[test]
fn the_delay_is_the_oracles_full_jitter_of_the_domains_ceiling() {
    let policy = resolve(None, None);
    let mut schedule = drawing(&[0.5]);

    // The ceilings are 1s, 2s, 4s (`reconnect.rs` pins those); half of each is what a draw of 0.5
    // buys. FULL jitter, not "half the ceiling plus a wobble": the oracle multiplies the whole base.
    assert_eq!(schedule.delay_ms(1, &policy), 500);
    assert_eq!(schedule.delay_ms(2, &policy), 1_000);
    assert_eq!(schedule.delay_ms(3, &policy), 2_000);
}

#[test]
fn a_draw_of_zero_is_the_floor_rather_than_an_immediate_retry() {
    let policy = resolve(None, None);

    // `Math.max(250, …)`. Without it, full jitter's own lower end IS the retry storm the back-off
    // exists to prevent — every dropped connection drawing near zero at once.
    assert_eq!(drawing(&[0.0]).delay_ms(1, &policy), MINIMUM_DELAY_MS);
}

#[test]
fn a_draw_of_almost_one_stays_under_the_ceiling() {
    let policy = resolve(None, None);
    let ceiling = policy.base_delay_ms(1);

    let delay = drawing(&[0.999]).delay_ms(1, &policy);

    assert_eq!(delay, 999);
    assert!(
        delay < ceiling,
        "the ceiling is exclusive: {delay} must be under {ceiling}"
    );
}

#[test]
fn a_source_answering_outside_the_unit_interval_still_cannot_pass_the_ceiling() {
    let policy = resolve(None, None);
    let ceiling = policy.base_delay_ms(4);

    // Not a hypothetical: `unit` is a seam a caller supplies, and a delay past the ceiling would
    // silently break `maxMs` — the one bound in the policy a user can actually see.
    assert_eq!(drawing(&[5.0]).delay_ms(4, &policy), ceiling);
    assert_eq!(drawing(&[-1.0]).delay_ms(4, &policy), MINIMUM_DELAY_MS);
}

#[test]
fn two_connections_dropped_together_do_not_retry_in_lockstep() {
    // The whole reason the jitter exists. Same policy, same attempt, same ceiling — and the delays
    // differ, which is the only property that matters to the engine they are both dialling.
    let policy = resolve(None, None);

    let first = drawing(&[0.2]).delay_ms(3, &policy);
    let second = drawing(&[0.8]).delay_ms(3, &policy);

    assert_ne!(first, second);
    assert_eq!((first, second), (800, 3_200));
}

#[test]
fn the_default_schedule_draws_from_the_system_and_not_from_a_constant() {
    // `Default` is what a caller reaches for without thinking, so it has to be the JITTERED one: a
    // default that answered the ceiling every time would put the whole fleet back in lockstep while
    // every test in this file still passed.
    let policy = resolve(None, None);
    let mut schedule = JitteredBackoff::default();

    let delays: Vec<u64> = (0..100).map(|_| schedule.delay_ms(6, &policy)).collect();

    let first = delays[0];
    assert!(
        delays.iter().any(|delay| *delay != first),
        "the default draws: 100 delays that are all {first} is a constant"
    );
}

#[test]
fn a_schedule_says_what_kind_it_is_without_reaching_into_its_source() {
    // `BackoffSchedule` requires `Debug`, and a `ConnectionMachine`'s own `Debug` prints its
    // schedule — so this is rendered wherever a machine is. A closure has none, hence the hand-written
    // impl; what it must not do is fail to name the type it is.
    let rendered = format!("{:?}", JitteredBackoff::default());

    assert!(
        rendered.contains("JitteredBackoff"),
        "a schedule in a failing assertion has to say which one it is: {rendered}"
    );
}

#[test]
fn the_system_source_draws_inside_the_bounds_and_does_not_repeat_itself() {
    let policy = resolve(None, None);
    let ceiling = policy.base_delay_ms(5);
    let mut schedule = JitteredBackoff::system();

    let delays: Vec<u64> = (0..200).map(|_| schedule.delay_ms(5, &policy)).collect();

    for delay in &delays {
        assert!(
            (MINIMUM_DELAY_MS..=ceiling).contains(delay),
            "{delay} is outside {MINIMUM_DELAY_MS}..={ceiling}"
        );
    }
    // Both directions, because a source stuck on one value satisfies the bounds perfectly and is
    // exactly the lockstep this exists to prevent.
    let first = delays[0];
    assert!(
        delays.iter().any(|delay| *delay != first),
        "200 draws that are all {first} is not a random source"
    );
}
