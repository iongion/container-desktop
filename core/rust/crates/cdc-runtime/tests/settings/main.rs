//! `cdc-runtime/src/settings/` — the store and the watcher.
//!
//! Distinct from `domain/settings/`, which is the DOCUMENT: this is the file on disk, its lock and
//! its change notifications.

#[path = "../fakes/mod.rs"]
mod fakes;

mod store;
mod watch;
