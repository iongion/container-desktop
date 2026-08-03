//! The native host: one concrete implementation of the runtime's capabilities, for machines with a
//! kernel, a filesystem and processes.
//!
//! Everything platform-specific in this project lives here and nowhere else — `tokio::process`,
//! `nix::killpg`, `fs4`'s advisory locks, `tempfile`'s atomic persist, `ssh2-config`'s grammar,
//! `SystemTime`, and the process environment. Not one of those exists on `wasm32-unknown-unknown`,
//! which is exactly why they are quarantined in a crate of their own rather than behind a `#[cfg]`.
//!
//! The dependency runs one way — this crate depends on `cdc-runtime`, never the reverse — so the
//! runtime cannot reach a facility even by accident. A second host (browser, an embedder's bridge, a
//! Go caller) is a sibling of this crate: it implements the same four traits over whatever its
//! platform offers and changes nothing above it.
//!
//! | This crate | Implements |
//! |---|---|
//! | [`backoff`] | `domain::reconnect::BackoffSchedule` — the jitter a live retry is drawn with |
//! | [`command`] | `capabilities::command::Command` — run, stream, spawn a service, kill its group |
//! | [`fs`] | `capabilities::fs::Fs` + `Clock` — locked, atomic writes and the system clock |
//! | [`http`] | `capabilities::http::Http` — one HTTP/1.1 exchange over a socket, pipe or port |
//! | [`ssh_config`] | the user's real `~/.ssh/config`, read by a real parser, as controller scopes |
//! | [`paths`] | where settings and sockets resolve on this platform |

// Entropy is as native as a clock is: `fastrand` seeds from the platform, and a pure runtime that
// drew its own would stop being replayable. decision 2 leaves the seam in the domain and
// the draw here.
pub mod backoff;
pub mod command;
pub mod fs;
// The engine's own API. Native because it needs real sockets — `tokio::net` is no more portable than
// `tokio::process`.
pub mod http;
// Where settings, sockets and `~` resolve here — the only part of the settings path rule that needs
// the environment. The rule itself is pure (`cdc_runtime::domain::settings::paths`).
pub mod paths;
// `~/.ssh/config` as controller scopes. A host concern because reading it needs the `Fs`
// capability — the runtime only ever SELECTS from a list handed to it as data.
pub mod ssh_config;
