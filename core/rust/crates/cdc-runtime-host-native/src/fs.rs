//! The real filesystem capability.
//!
//! Two guarantees, both, and both bought from libraries rather than hand-rolled:
//! `tempfile` for same-directory temporaries and the atomic persist, `fs4` for the cross-platform
//! advisory lock. What is written here is the policy around them — create the directory, flush
//! before the rename, retry the replace on Windows, bound the wait for the lock.

use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use cdc_runtime::capabilities::fs::{Fs, FsError, FsLocks};
use cdc_runtime::domain::ssh::forward::windows_pipe_name;
use fs4::{FileExt, TryLockError};

/// The named-pipe filesystem. A real directory, which is the whole point: it can be LISTED.
const WINDOWS_PIPE_DIRECTORY: &str = r"\\.\pipe\";

/// Whether `directory` lists an entry with this name, compared case-insensitively.
///
/// Enumeration is the only presence question NPFS answers honestly — it does not care how many
/// instances are free, and it makes no connection. A directory that cannot be read answers `false`,
/// which off Windows is every call: the pipe filesystem is not there, and `exists()` would have said
/// the same for such a path.
///
/// **The directory is a parameter, and that is a test seam stated rather than hidden.** `\\.\pipe\`
/// exists only on Windows, so no gate that runs here could execute a line of this — and an unexecuted
/// matcher is precisely where `eq_ignore_ascii_case` silently becomes `==` and nothing notices. A test
/// points it at a real directory holding a file named like a pipe.
pub fn entry_is_listed(directory: &Path, name: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case(name)
    })
}

/// Windows refuses to replace a file another process has open. The retry turns a transient
/// antivirus or indexer window into a delay instead of a failed write.
const REPLACE_ATTEMPTS: u32 = 5;
const REPLACE_BACKOFF: Duration = Duration::from_millis(20);

/// How often to re-attempt the lock while waiting. Short enough to feel immediate, long enough not
/// to spin a core.
const LOCK_POLL_INTERVAL: Duration = Duration::from_millis(5);

/// Unwrap an `io::Result`, or return with the operation and the path attached:
/// `io_context!(std::fs::create_dir_all(directory), "create", directory)`.
///
/// One spelling rather than the seven identical `map_err` closures it replaces — "create failed for
/// /home/…: permission denied" is the whole point of `FsError::Io`, and seven copies is seven chances
/// to name the wrong operation. A macro rather than a helper because it expands INTO its caller: a
/// generic helper is a separate function per result type, each only reachable when that particular
/// call fails, and most of them never would be.
macro_rules! io_context {
    ($result:expr, $operation:literal, $path:expr) => {{
        // Bound before the match, so the path a failure would name is read on the way IN rather
        // than only on the way out.
        let path: &Path = $path;
        match $result {
            Ok(value) => value,
            Err(source) => return Err(io($operation, path, source)),
        }
    }};
}

#[derive(Debug, Clone, Copy, Default)]
pub struct StdFs;

/// Holds the lockfile open.
///
/// Holding the handle IS the lock: both `flock` and `LockFileEx` release when the descriptor closes,
/// so the lock's lifetime is this value's lifetime. An explicit `unlock` in a `Drop` would read as
/// the thing that releases it while doing nothing the close does not already do.
#[derive(Debug)]
pub struct FileLock {
    _file: std::fs::File,
}

impl Fs for StdFs {
    fn read_to_string(&self, path: &Path) -> Result<Option<String>, FsError> {
        match std::fs::read_to_string(path) {
            Ok(contents) => Ok(Some(contents)),
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(source) => Err(io("read", path, source)),
        }
    }

    fn write_atomic(&self, path: &Path, contents: &str) -> Result<(), FsError> {
        let directory = parent_of(path);
        io_context!(std::fs::create_dir_all(directory), "create", directory);

        let mut temporary = io_context!(
            tempfile::Builder::new()
                .prefix(".user-settings")
                .suffix(".tmp")
                .tempfile_in(directory),
            "create temporary file in",
            directory
        );
        let written = temporary.write_all(contents.as_bytes());
        io_context!(written, "write", temporary.path());
        // Flush to the device before the rename, or a crash can leave the renamed file empty on
        // filesystems that reorder the two.
        let flushed = temporary.as_file().sync_all();
        io_context!(flushed, "flush", temporary.path());

        persist(temporary, path)
    }

    fn modified_nanos(&self, path: &Path) -> Result<Option<u128>, FsError> {
        let metadata = match std::fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(source) => return Err(io("stat", path, source)),
        };
        let modified = io_context!(metadata.modified(), "read modification time of", path);
        Ok(Some(
            modified
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ))
    }

    /// `std::fs::exists` would distinguish "absent" from "cannot tell"; the capability deliberately
    /// does not, so a permission-denied parent reads as absent exactly as the original's
    /// `isFilePresent` does.
    ///
    /// **A Windows named pipe is not answerable by `exists`, and the difference is not academic.**
    /// `Path::exists` is `metadata().is_ok()`, and on Windows that OPENS the path — for a pipe, opening
    /// is becoming a CLIENT of it. Measured against a live Docker Desktop on Windows 11: `exists()`
    /// answered `true` for `\\.\pipe\dockerDesktopLinuxEngine` and consumed one of the server's
    /// instances doing it, while `metadata()` on the same path microseconds later failed with "All pipe
    /// instances are busy" (os error 231). So the answer is racy, it is `false` for a perfectly healthy
    /// engine that happens to be saturated, and asking it disturbs the thing it measures.
    fn is_file_present(&self, path: &Path) -> bool {
        if let Some(name) = windows_pipe_name(&path.to_string_lossy()) {
            return entry_is_listed(Path::new(WINDOWS_PIPE_DIRECTORY), name);
        }
        path.exists()
    }

    fn mkdir(&self, path: &Path) -> Result<(), FsError> {
        io_context!(std::fs::create_dir_all(path), "create", path);
        Ok(())
    }
}

impl FsLocks for StdFs {
    type Lock = FileLock;

    fn lock_exclusive(&self, path: &Path, timeout: Duration) -> Result<Self::Lock, FsError> {
        let directory = parent_of(path);
        io_context!(std::fs::create_dir_all(directory), "create", directory);
        let file = io_context!(
            std::fs::OpenOptions::new()
                .create(true)
                .read(true)
                .write(true)
                .truncate(false)
                .open(path),
            "open lockfile",
            path
        );

        poll_for_lock(path, timeout, &mut || FileExt::try_lock(&file))?;
        Ok(FileLock { _file: file })
    }
}

/// Retry `attempt` until it succeeds, it fails for a reason retrying cannot fix, or `timeout` runs
/// out.
///
/// Polled rather than blocking, because a blocking acquire has no timeout and a core that hangs
/// forever on a stale lock is worse than one that reports contention.
///
/// The attempt is a parameter because the rule that matters most here cannot be provoked from a real
/// file: `flock` fails outright only for a bad descriptor or an exhausted kernel lock table, and
/// retrying such a failure until the deadline would report contention that never existed.
pub fn poll_for_lock(
    path: &Path,
    timeout: Duration,
    attempt: &mut dyn FnMut() -> Result<(), TryLockError>,
) -> Result<(), FsError> {
    let deadline = Instant::now() + timeout;
    loop {
        match attempt() {
            Ok(()) => return Ok(()),
            Err(TryLockError::WouldBlock) => {}
            Err(TryLockError::Error(source)) => return Err(io("lock", path, source)),
        }
        if Instant::now() >= deadline {
            return Err(FsError::LockTimeout {
                path: path.to_path_buf(),
                waited: timeout,
            });
        }
        std::thread::sleep(LOCK_POLL_INTERVAL);
    }
}

/// Rename over the target, retrying while Windows holds it open.
///
/// The last attempt is made outside the loop so there is no "ran out of attempts without answering"
/// case for a reader — or a compiler — to wonder about.
fn persist(mut temporary: tempfile::NamedTempFile, path: &Path) -> Result<(), FsError> {
    for _ in 1..REPLACE_ATTEMPTS {
        match temporary.persist(path) {
            Ok(_) => return Ok(()),
            Err(error) => {
                temporary = error.file;
                std::thread::sleep(REPLACE_BACKOFF);
            }
        }
    }
    temporary
        .persist(path)
        .map(|_| ())
        .map_err(|_| FsError::ReplaceExhausted {
            path: path.to_path_buf(),
            attempts: REPLACE_ATTEMPTS,
        })
}

/// The directory a path sits in. A path with no directory in it sits in this one.
fn parent_of(path: &Path) -> &Path {
    path.parent().unwrap_or(Path::new("."))
}

fn io(operation: &'static str, path: &Path, source: std::io::Error) -> FsError {
    FsError::Io {
        operation,
        path: path.to_path_buf(),
        source,
    }
}

/// The wall clock. Milliseconds since the epoch, which is monotonic enough for a debounce window
/// and legible in a log line, unlike an `Instant`.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl cdc_runtime::capabilities::clock::Clock for SystemClock {
    fn now_millis(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
}
