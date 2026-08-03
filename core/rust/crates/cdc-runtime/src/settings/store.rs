//! The one path through which `user-settings.json` is written.
//!
//! Every mutation is: acquire the advisory lock → **re-read the document from disk** → apply →
//! write a temporary file → flush → rename over the target → release. Re-reading inside the lock is
//! what makes it correct; a document read beforehand is already stale, and the desktop app may have
//! written between the two.
//!
//! CRUD is expressed in terms of `mutate` rather than beside it, so there is no second write path
//! that could forget a step.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::capabilities::fs::{FsError, FsLocks};
use crate::domain::settings::document::{DocumentError, SettingsDocument};
use crate::domain::types::connection::Connection;
use serde_json::Value;

/// Long enough to outlast another writer's short critical section, short enough that a stale lock
/// surfaces as an error rather than a hang.
const DEFAULT_LOCK_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error(transparent)]
    Fs(#[from] FsError),
    #[error(transparent)]
    Document(#[from] DocumentError),
}

pub struct SettingsStore<F: FsLocks> {
    fs: F,
    path: PathBuf,
    lock_path: PathBuf,
    app_version: String,
    lock_timeout: Duration,
}

impl<F: FsLocks> SettingsStore<F> {
    pub fn new(fs: F, path: impl AsRef<Path>, app_version: impl Into<String>) -> Self {
        let path = path.as_ref().to_path_buf();
        Self {
            lock_path: lock_path_for(&path),
            fs,
            path,
            app_version: app_version.into(),
            lock_timeout: DEFAULT_LOCK_TIMEOUT,
        }
    }

    pub fn with_lock_timeout(mut self, timeout: Duration) -> Self {
        self.lock_timeout = timeout;
        self
    }

    /// Read without taking the lock. Correct for a snapshot, never as the input to a write — see
    /// `mutate`, which re-reads for exactly that reason.
    pub fn read(&self) -> Result<SettingsDocument, SettingsError> {
        let contents = self.fs.read_to_string(&self.path)?;
        Ok(SettingsDocument::parse(
            contents.as_deref().unwrap_or("{}"),
        )?)
    }

    /// Lock, re-read, apply, replace atomically, release.
    pub fn mutate<T>(
        &self,
        change: impl FnOnce(&mut SettingsDocument, &str) -> T,
    ) -> Result<T, SettingsError> {
        let _lock = self.fs.lock_exclusive(&self.lock_path, self.lock_timeout)?;
        let mut document = self.read()?;
        let outcome = change(&mut document, &self.app_version);
        self.fs.write_atomic(&self.path, &document.to_json())?;
        Ok(outcome)
    }

    /// `Application.getConnectionsFromConfiguration` — read, and migrate the pre-migration layout
    /// through the locked path if it is still there.
    pub fn connections(&self) -> Result<Vec<Connection>, SettingsError> {
        let document = self.read()?;
        if !document.needs_legacy_migration() {
            return Ok(document.connections()?);
        }
        self.mutate(|document, app_version| document.migrate_legacy_connections(app_version))?;
        Ok(self.read()?.connections()?)
    }

    pub fn create_connection(&self, connection: &Value) -> Result<(), SettingsError> {
        self.mutate(|document, app_version| document.create_connection(connection, app_version))
    }

    pub fn update_connection(&self, id: &str, partial: &Value) -> Result<(), SettingsError> {
        self.mutate(|document, app_version| document.update_connection(id, partial, app_version))
    }

    pub fn remove_connection(&self, id: &str) -> Result<(), SettingsError> {
        self.mutate(|document, app_version| document.remove_connection(id, app_version))
    }
}

/// Where a lockfile sits for a given target: a sibling, so it shares the target's directory and
/// therefore its filesystem.
///
/// Portable, and it lives beside its only caller rather than in the native host: it is a PATH RULE,
/// not a filesystem call, and the store that needs it runs on every target.
pub fn lock_path_for(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".lock");
    path.parent().unwrap_or(Path::new(".")).join(name)
}
