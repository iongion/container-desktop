//! The clock capability.
//!
//! Time is injected so that anything timed — the settings watcher's debounce today, reconnect
//! back-off — is testable without sleeping. A test that waits for real time is slow
//! and, worse, flaky under load.

/// `Send + Sync` for the same reason [`crate::capabilities::command::Command`] is: a server holds one
/// clock and hands it to every connection it owns, across threads. Every implementation is a system
/// call or a counter, so the bound costs nothing.
pub trait Clock: Send + Sync {
    /// Milliseconds since an arbitrary but monotonic origin. Only differences are meaningful.
    fn now_millis(&self) -> u64;
}
