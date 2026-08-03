//! Reconnect policy and back-off.
//!
//! The oracle is `engineDataService.ts:resolveReconnectPolicy` + `backoffDelay`. Two of its rules are
//! easy to get wrong and are therefore stated as tests rather than as comments: the per-connection
//! flag overrides the global one even when it says NO, and `maxRetries` is compared against the
//! UPCOMING attempt, so `maxRetries: 3` allows three retries and gives up on the fourth.
//!
//! What is deliberately NOT here is the jitter. The oracle multiplies the delay by a random factor so
//! that simultaneous drops — the internet going down takes every remote connection at once — do not
//! retry in lockstep. Randomness cannot live in a pure domain and a jittered schedule cannot be pinned
//! by a transcript, so this computes the deterministic CEILING of the oracle's delay, and
//! [`BackoffSchedule`] is the seam a jittered one is injected through when something actually schedules
//! live retries (the server,). Writing it before then would be a generator with no consumer.

use crate::domain::types::user_settings::ReconnectPolicy;

/// `initialMs` when nothing is configured.
pub const DEFAULT_INITIAL_MS: u64 = 1_000;

/// `maxMs` when nothing is configured.
pub const DEFAULT_MAX_MS: u64 = 30_000;

/// `factor` when nothing is configured.
pub const DEFAULT_FACTOR: f64 = 2.0;

/// The oracle's floor. A retry faster than this is a retry storm, whatever the policy says.
pub const MINIMUM_DELAY_MS: u64 = 250;

/// How long a connection must stay up before its attempt counter is forgiven
/// (`RECONNECT_STABLE_MS`). Without it a flapping engine resets to a tight retry on every brief
/// connect, which is the retry storm the back-off exists to prevent.
pub const STABLE_MS: u64 = 30_000;

/// The policy actually in force for one connection: the per-connection override resolved against the
/// global default, with every absent field defaulted.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedReconnectPolicy {
    pub enabled: bool,
    pub initial_ms: u64,
    pub max_ms: u64,
    pub factor: f64,
    pub max_retries: Option<u32>,
}

/// `perConnection ?? global?.enabled ?? true`, then each timing on its own.
///
/// `auto_reconnect` is `Connection.settings.api.autoReconnect`; `global` is
/// `GlobalUserSettings.reconnect`. Both are optional and they default independently — a global policy
/// that sets only `enabled` keeps the default timings rather than zeroing them.
pub fn resolve(
    auto_reconnect: Option<bool>,
    global: Option<&ReconnectPolicy>,
) -> ResolvedReconnectPolicy {
    ResolvedReconnectPolicy {
        enabled: auto_reconnect
            .or(global.map(|policy| policy.enabled))
            .unwrap_or(true),
        initial_ms: millis(
            global.and_then(|policy| policy.initial_ms),
            DEFAULT_INITIAL_MS,
        ),
        max_ms: millis(global.and_then(|policy| policy.max_ms), DEFAULT_MAX_MS),
        factor: global
            .and_then(|policy| policy.factor)
            .filter(|factor| factor.is_finite())
            .unwrap_or(DEFAULT_FACTOR),
        max_retries: global
            .and_then(|policy| policy.max_retries)
            .map(|retries| retries.max(0) as u32),
    }
}

/// The schema types these as plain integers, so a hand-edited settings file can carry a negative one.
/// Clamping rather than rejecting keeps a nonsensical value from becoming a panic or a busy loop; the
/// floor in [`ResolvedReconnectPolicy::base_delay_ms`] then makes the delay usable.
fn millis(configured: Option<i64>, default: u64) -> u64 {
    configured
        .map(|value| value.max(0) as u64)
        .unwrap_or(default)
}

impl ResolvedReconnectPolicy {
    /// The delay before `attempt`, exponential from `initial_ms`, capped at `max_ms`, floored at
    /// [`MINIMUM_DELAY_MS`].
    ///
    /// This is the CEILING of what the oracle waits: with full jitter it waits a random fraction of
    /// this. Under replay the ceiling is what the corpus pins, because it is the only value that is
    /// the same on every run and in every language.
    pub fn base_delay_ms(&self, attempt: u32) -> u64 {
        // `min` bounds the exponent so an absurd attempt count cannot overflow the cast; the result
        // saturates at `max_ms` long before that anyway.
        let exponent = attempt.saturating_sub(1).min(1_024) as i32;
        let scaled = self.initial_ms as f64 * self.factor.powi(exponent);
        // The cast saturates, so an infinite or NaN product becomes 0 rather than nonsense, and the
        // floor then makes even a policy of zeros usable. A retry faster than the floor is a storm,
        // whatever the policy says.
        (scaled.min(self.max_ms as f64).floor() as u64).max(MINIMUM_DELAY_MS)
    }

    /// Whether `attempt` is one retry too many. A disabled policy is exhausted before the first.
    pub fn exhausted(&self, attempt: u32) -> bool {
        if !self.enabled {
            return true;
        }
        self.max_retries
            .is_some_and(|max_retries| attempt > max_retries)
    }
}

/// How long to wait before a retry — the seam the jitter is injected through.
///
/// `&mut self` so an implementation may carry generator state; the domain's own implementation needs
/// none. Constructor injection (`ConnectionMachine::with_backoff`) rather than a global, so a replay
/// and a live connection can differ without a feature flag.
/// `Send + Sync` because a machine is owned by a server that serves every client from one shared
/// instance: the schedule travels with the machine, across threads. Every implementation is a counter or
/// a pure function of the attempt number, so the bound costs nothing.
pub trait BackoffSchedule: std::fmt::Debug + Send + Sync {
    fn delay_ms(&mut self, attempt: u32, policy: &ResolvedReconnectPolicy) -> u64;
}

/// The schedule the corpus replays: exactly the policy's own curve, with no randomness.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DeterministicBackoff;

impl BackoffSchedule for DeterministicBackoff {
    fn delay_ms(&mut self, attempt: u32, policy: &ResolvedReconnectPolicy) -> u64 {
        policy.base_delay_ms(attempt)
    }
}
