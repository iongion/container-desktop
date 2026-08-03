//! The filesystem capability.
//!
//! Deliberately **synchronous**, unlike `Command`. The one filesystem operation this core performs
//! is a short read-modify-write of a small JSON document under an advisory lock, and an async
//! signature there invites holding that lock across an `await` — which is how a critical section
//! stops being short. A caller inside a runtime wraps the call, rather than the capability pretending the
//! lock is cancellable.

use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("{operation} failed for {path}: {source}")]
    Io {
        operation: &'static str,
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("timed out after {waited:?} waiting for the lock on {path}")]
    LockTimeout { path: PathBuf, waited: Duration },
    /// Windows cannot always rename over a file another process holds open. Distinct from `Io` so a
    /// caller can say "another program is holding user-settings.json" instead of "os error 5".
    #[error("could not replace {path} after {attempts} attempts — another process is holding it")]
    ReplaceExhausted { path: PathBuf, attempts: u32 },
}

/// `host-contract/src/fs.ts:IFileSystem` — what the runtime needs of a filesystem.
///
/// **Object-safe**, and that is load-bearing rather than incidental: the composed
/// [`HostClient`](crate::runtimes::host_client) holds one of these behind an `Arc` and hands it to
/// units that are themselves trait objects, so an associated type here would force the whole
/// composition to be generic. The advisory lock is therefore NOT on this trait — see [`FsLocks`].
///
/// `Send + Sync` because a connection is driven from a spawned task.
pub trait Fs: Send + Sync {
    /// `None` when the file does not exist — the caller starts from an empty document. Anything
    /// else that goes wrong is an error, so a misconfigured path cannot masquerade as a fresh
    /// installation.
    fn read_to_string(&self, path: &Path) -> Result<Option<String>, FsError>;

    /// Write via a temporary file in the same directory, flush it to disk, then rename over the
    /// target. A crash can therefore lose the write but never truncate the previous contents.
    fn write_atomic(&self, path: &Path, contents: &str) -> Result<(), FsError>;

    /// Modification time in nanoseconds since the epoch, for change detection. `None` when absent.
    fn modified_nanos(&self, path: &Path) -> Result<Option<u128>, FsError>;

    /// `IFileSystem.isFilePresent` — whether anything is at this path.
    ///
    /// A plain `bool` and not a `Result`, matching the original: every caller (the program gate, the
    /// API socket check, the socket base-dir check) treats "cannot stat it" and "it is not there" as
    /// the same answer, and a `Result` would invite one of them to invent a third.
    fn is_file_present(&self, path: &Path) -> bool;

    /// `IFileSystem.mkdir(location, { recursive: true })` — every call site in the original passes
    /// `recursive`, so it is the behaviour rather than an option. Succeeds when the directory is
    /// already there.
    fn mkdir(&self, path: &Path) -> Result<(), FsError>;
}

/// The advisory lock, kept off [`Fs`] because it is the only operation with a guard.
///
/// It is also the only one the original's `IFileSystem` does not have — it exists for the design's
/// concurrent-writer story and nothing else — so isolating it here is what makes [`Fs`] both
/// object-safe and a closer match to the port it came from. Only `SettingsStore` needs it.
pub trait FsLocks: Fs {
    /// Released on drop.
    type Lock;

    /// Take an advisory exclusive lock on a sibling lockfile, waiting up to `timeout`.
    ///
    /// Advisory means cooperative: it protects this core from itself and from other instances of
    /// it, and nothing more. The desktop app does not take this lock today.
    fn lock_exclusive(&self, path: &Path, timeout: Duration) -> Result<Self::Lock, FsError>;
}
