//! The jittered back-off a LIVE scheduler retries on.
//!
//! [`cdc_runtime::domain::reconnect`] computes the CEILING of the oracle's delay and says why it stops
//! there: randomness cannot live in a pure domain, and a schedule pinned by a transcript cannot have
//! any. [`BackoffSchedule`] is the seam it leaves, and the first thing to schedule real retries is
//! the server. That is [`crate::backoff`]'s caller, so this is where
//! `Math.random()` finally appears.
//!
//! **Full jitter, which is the oracle's** (`engineDataService.ts:backoffDelay`): the delay is drawn
//! uniformly from the whole interval below the ceiling rather than wobbled around it. The reason is the
//! failure it prevents. One event takes many connections at once — the internet goes down, a VPN
//! reconnects, a laptop wakes — and every one of them then computes the same ceiling from the same
//! policy. Unjittered, they arrive at their engines in the same millisecond, fail together, and do it
//! again on a doubled delay: the retry storm that the back-off itself was supposed to be the answer to.
//!
//! **The draw is injected rather than called for**, which is what makes the schedule assertable at all.
//! A test hands it a sequence and every delay becomes an equality; production hands it [`fastrand`].

use cdc_runtime::domain::reconnect::{BackoffSchedule, MINIMUM_DELAY_MS, ResolvedReconnectPolicy};

/// A back-off schedule that draws a delay from below the policy's ceiling.
///
/// Holds the source rather than calling a global, for the reason the module doc gives — and `FnMut`
/// because a generator that carries state is the ordinary shape of one, which is also why
/// [`BackoffSchedule::delay_ms`] takes `&mut self`.
pub struct JitteredBackoff {
    /// Answers a fraction in `[0, 1)`. Nothing enforces that here, and [`JitteredBackoff::delay_ms`]
    /// is written not to need it: a source is a caller's, and a bound this type states is a bound this
    /// type keeps.
    unit: Box<dyn FnMut() -> f64 + Send + Sync>,
}

impl JitteredBackoff {
    /// A schedule drawing from `unit`.
    pub fn new(unit: impl FnMut() -> f64 + Send + Sync + 'static) -> Self {
        Self {
            unit: Box::new(unit),
        }
    }

    /// A schedule drawing from this machine's entropy — what a server retries on.
    pub fn system() -> Self {
        Self::new(fastrand::f64)
    }
}

impl Default for JitteredBackoff {
    fn default() -> Self {
        Self::system()
    }
}

impl std::fmt::Debug for JitteredBackoff {
    /// Hand-written because a closure has no `Debug`, and the closure is the only field. What a
    /// failing assertion needs from a schedule is which KIND it is, and there is one kind.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("JitteredBackoff").finish()
    }
}

impl BackoffSchedule for JitteredBackoff {
    /// `max(250, floor(random() × base))`, which is `backoffDelay` exactly.
    ///
    /// **The floor is applied to the drawn value, not to the base, and the two agree.** The oracle
    /// floors after multiplying an unfloored base; [`ResolvedReconnectPolicy::base_delay_ms`] has
    /// already applied the same floor to the base it answers. Where the base is above 250 the floor
    /// changes neither of them, and where it is below, both end at exactly 250 — because a draw from
    /// below 250 is below 250 either way. So the ceiling can be taken from the domain, which keeps one
    /// definition of the curve rather than a second one here that could drift from it.
    ///
    /// The two bounds are kept against ANY answer the source gives, including one outside `[0, 1)`, a
    /// NaN or an infinity: `as` saturates, and clamping the result rather than the draw means the
    /// promise is about the delay — which is the thing `maxMs` is a promise about.
    fn delay_ms(&mut self, attempt: u32, policy: &ResolvedReconnectPolicy) -> u64 {
        let ceiling = policy.base_delay_ms(attempt);
        let drawn = ((self.unit)() * ceiling as f64).floor() as u64;
        // `min` before `max`, so a policy whose ceiling somehow fell below the floor answers the
        // floor. A retry faster than that is a storm whatever the policy says, and `clamp` would
        // panic on the same pair rather than deciding it.
        drawn.min(ceiling).max(MINIMUM_DELAY_MS)
    }
}
