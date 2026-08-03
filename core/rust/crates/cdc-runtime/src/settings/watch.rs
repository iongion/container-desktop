//! Noticing that someone else changed `user-settings.json`.
//!
//! Polled rather than event-driven, deliberately. `notify` is on the domain's forbidden list and
//! would be a platform-specific backend here for a single small file that changes when a human
//! clicks something; a stat call on each tick costs nothing at that rate. It is also the only
//! design that behaves identically over the network filesystems people keep their home directory
//! on, where inotify reports nothing at all.
//!
//! Debouncing is a trailing edge: each observed change restarts the quiet period, so the several
//! filesystem events an atomic write produces settle into exactly one reload.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::capabilities::clock::Clock;
use crate::capabilities::fs::Fs;
use crate::domain::settings::document::SettingsDocument;

use crate::settings::store::SettingsError;

pub struct SettingsWatcher<F: Fs, C: Clock> {
    fs: F,
    clock: C,
    path: PathBuf,
    debounce: Duration,
    seen_nanos: Option<u128>,
    seen_contents: Option<String>,
    changed_at_millis: Option<u64>,
}

impl<F: Fs, C: Clock> SettingsWatcher<F, C> {
    /// Does no I/O — call `prime` to record the starting state.
    pub fn new(fs: F, clock: C, path: impl AsRef<Path>, debounce: Duration) -> Self {
        Self {
            fs,
            clock,
            path: path.as_ref().to_path_buf(),
            debounce,
            seen_nanos: None,
            seen_contents: None,
            changed_at_millis: None,
        }
    }

    /// Record the current state and return it, so the first `poll` reports a change only if one
    /// really happened afterwards.
    pub fn prime(&mut self) -> Result<SettingsDocument, SettingsError> {
        self.seen_nanos = self.fs.modified_nanos(&self.path)?;
        let contents = self.fs.read_to_string(&self.path)?;
        let document = SettingsDocument::parse(contents.as_deref().unwrap_or("{}"))?;
        self.seen_contents = contents;
        self.changed_at_millis = None;
        Ok(document)
    }

    /// `Some` exactly once per settled change, `None` while quiet or still settling.
    pub fn poll(&mut self) -> Result<Option<SettingsDocument>, SettingsError> {
        let now = self.clock.now_millis();
        let modified = self.fs.modified_nanos(&self.path)?;
        if modified != self.seen_nanos {
            self.seen_nanos = modified;
            self.changed_at_millis = Some(now);
        }

        let Some(changed_at) = self.changed_at_millis else {
            return Ok(None);
        };
        if now.saturating_sub(changed_at) < self.debounce.as_millis() as u64 {
            return Ok(None);
        }
        self.changed_at_millis = None;

        // The timestamp moved, which is not the same as the contents moving: a `touch`, or a write
        // that produced identical bytes, must not make every consumer rebuild its state.
        let contents = self.fs.read_to_string(&self.path)?;
        if contents == self.seen_contents {
            return Ok(None);
        }
        let document = SettingsDocument::parse(contents.as_deref().unwrap_or("{}"))?;
        self.seen_contents = contents;
        Ok(Some(document))
    }
}
