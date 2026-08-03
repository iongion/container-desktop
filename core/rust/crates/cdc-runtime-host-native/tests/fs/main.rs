//! The real `Fs` capability: atomic replacement and advisory locking.
//!
//! Both guarantees are filesystem behaviour, which the exec corpus cannot cover — so they are
//! covered here, and each is checked by making it fail rather than by reading the implementation.

// What the REAL filesystem adds to `cdc-runtime`'s pure settings modules: an advisory lock under
// genuine contention, and a watcher against the several events one atomic rename actually emits.
mod store;
mod watch;

use std::io::Write;
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use cdc_runtime::capabilities::fs::{Fs, FsError, FsLocks};
use cdc_runtime_host_native::fs::{StdFs, entry_is_listed};

fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("a temporary directory")
}

#[test]
fn a_missing_file_reads_as_none_rather_than_an_error() {
    let dir = temp_dir();
    let missing = dir.path().join("user-settings.json");
    assert_eq!(StdFs.read_to_string(&missing).expect("read succeeds"), None);
}

#[test]
fn write_atomic_creates_then_replaces() {
    let dir = temp_dir();
    let target = dir.path().join("user-settings.json");

    StdFs.write_atomic(&target, "{}").expect("first write");
    assert_eq!(
        StdFs.read_to_string(&target).expect("read"),
        Some("{}".to_string())
    );

    StdFs
        .write_atomic(&target, "{\"a\":1}")
        .expect("second write");
    assert_eq!(
        StdFs.read_to_string(&target).expect("read"),
        Some("{\"a\":1}".to_string())
    );
}

#[cfg(unix)]
#[test]
fn write_atomic_replaces_by_rename_so_an_interrupted_write_cannot_truncate() {
    // The crash-safety claim, made checkable: a rename swaps a NEW inode into place, so the old
    // file is whole until the instant it is replaced. Truncate-and-rewrite would keep the inode and
    // would leave a half-written configuration behind if the process died mid-write.
    use std::os::unix::fs::MetadataExt;

    let dir = temp_dir();
    let target = dir.path().join("user-settings.json");
    StdFs
        .write_atomic(&target, "original")
        .expect("first write");
    let before = std::fs::metadata(&target).expect("metadata").ino();

    StdFs
        .write_atomic(&target, "replaced")
        .expect("second write");
    let after = std::fs::metadata(&target).expect("metadata").ino();

    assert_ne!(before, after, "the file must be replaced, not rewritten");
    assert_eq!(std::fs::read_to_string(&target).expect("read"), "replaced");
}

#[test]
fn an_interrupted_write_leaves_the_original_intact() {
    // Simulate the crash window: a temp file exists in the directory but the rename never happened.
    let dir = temp_dir();
    let target = dir.path().join("user-settings.json");
    StdFs
        .write_atomic(&target, "original")
        .expect("first write");

    let orphan = dir.path().join(".user-settings.json.interrupted.tmp");
    std::fs::File::create(&orphan)
        .expect("orphan temp file")
        .write_all(b"half-written")
        .expect("write orphan");

    assert_eq!(
        StdFs.read_to_string(&target).expect("read"),
        Some("original".to_string()),
        "an abandoned temp file must not affect the target"
    );
    StdFs.write_atomic(&target, "next").expect("write after");
    assert_eq!(
        StdFs.read_to_string(&target).expect("read"),
        Some("next".to_string())
    );
}

#[test]
fn write_atomic_leaves_no_temp_files_behind() {
    let dir = temp_dir();
    let target = dir.path().join("user-settings.json");
    StdFs.write_atomic(&target, "{}").expect("write");

    let entries: Vec<String> = std::fs::read_dir(dir.path())
        .expect("read dir")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(entries, ["user-settings.json"]);
}

#[test]
fn write_atomic_creates_the_directory_when_it_is_absent() {
    // A first run on a clean machine has no user-data directory yet; `write()` in config.ts mkdirs
    // before writing for exactly that reason.
    let dir = temp_dir();
    let target = dir.path().join("nested").join("user-settings.json");
    StdFs.write_atomic(&target, "{}").expect("write");
    assert_eq!(
        StdFs.read_to_string(&target).expect("read"),
        Some("{}".to_string())
    );
}

#[test]
fn a_second_holder_waits_for_the_lock_to_be_released() {
    let dir = temp_dir();
    let lock_path = dir.path().join("user-settings.json.lock");
    let (tx, rx) = mpsc::channel();

    let held = StdFs
        .lock_exclusive(&lock_path, Duration::from_secs(5))
        .expect("first lock");

    let waiter = {
        let lock_path = lock_path.clone();
        thread::spawn(move || {
            let lock = StdFs
                .lock_exclusive(&lock_path, Duration::from_secs(5))
                .expect("second lock eventually acquires");
            tx.send(()).expect("report acquisition");
            drop(lock);
        })
    };

    assert!(
        rx.recv_timeout(Duration::from_millis(200)).is_err(),
        "the second holder must not acquire while the first holds"
    );
    drop(held);
    rx.recv_timeout(Duration::from_secs(5))
        .expect("released lock is acquired");
    waiter.join().expect("waiter finishes");
}

#[test]
fn contention_times_out_with_a_distinct_error() {
    let dir = temp_dir();
    let lock_path = dir.path().join("user-settings.json.lock");
    let held = StdFs
        .lock_exclusive(&lock_path, Duration::from_secs(5))
        .expect("first lock");

    let outcome = StdFs.lock_exclusive(&lock_path, Duration::from_millis(50));
    assert!(
        matches!(outcome, Err(FsError::LockTimeout { .. })),
        "expected a lock timeout, got {outcome:?}"
    );
    drop(held);
}

#[test]
fn modified_nanos_moves_when_the_file_is_rewritten() {
    let dir = temp_dir();
    let target = dir.path().join("user-settings.json");
    assert_eq!(
        StdFs.modified_nanos(&target).expect("absent file"),
        None,
        "an absent file has no modification time"
    );

    StdFs.write_atomic(&target, "one").expect("write");
    let first = StdFs.modified_nanos(&target).expect("mtime").expect("some");
    thread::sleep(Duration::from_millis(10));
    StdFs.write_atomic(&target, "two").expect("write");
    let second = StdFs.modified_nanos(&target).expect("mtime").expect("some");

    assert!(second > first, "{second} should be later than {first}");
}

#[cfg(unix)]
#[test]
fn a_stat_that_fails_for_any_other_reason_is_an_error_not_an_absence() {
    // `None` means "not there yet, start from {}". A directory this user cannot look inside must not
    // read as that, or a permissions problem would silently produce an empty configuration and the
    // next write would replace the user's real one.
    use std::os::unix::fs::PermissionsExt;

    let dir = temp_dir();
    let locked = dir.path().join("locked");
    std::fs::create_dir(&locked).expect("mkdir");
    std::fs::write(locked.join("user-settings.json"), "{}").expect("seed");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).expect("chmod");

    let outcome = StdFs.modified_nanos(&locked.join("user-settings.json"));

    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).expect("restore");
    assert!(
        matches!(
            outcome,
            Err(FsError::Io {
                operation: "stat",
                ..
            })
        ),
        "expected a stat error, got {outcome:?}"
    );
}

#[cfg(unix)]
#[test]
fn a_directory_that_cannot_be_created_names_the_operation_that_failed() {
    // First run on a clean machine: the user-data directory is made on the way to the write. When
    // that is what fails, "create failed for …" is what tells the user their config directory is
    // unwritable, rather than a bare os error on the settings file.
    use std::os::unix::fs::PermissionsExt;

    let dir = temp_dir();
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).expect("chmod");

    let outcome = StdFs.write_atomic(&dir.path().join("nested").join("user-settings.json"), "{}");

    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).expect("restore");
    assert!(
        matches!(
            outcome,
            Err(FsError::Io {
                operation: "create",
                ..
            })
        ),
        "got {outcome:?}"
    );
}

#[test]
fn the_lockfile_sits_beside_its_target() {
    // Beside it, so it shares the target's directory and therefore its filesystem — an advisory
    // lock taken on another filesystem excludes nothing.
    assert_eq!(
        cdc_runtime::settings::store::lock_path_for(Path::new("/data/user-settings.json")),
        Path::new("/data/user-settings.json.lock")
    );
    assert_eq!(
        cdc_runtime::settings::store::lock_path_for(Path::new("user-settings.json")),
        Path::new("user-settings.json.lock"),
        "a target with no directory in it is already in the one it will be locked in"
    );
}

#[test]
fn a_target_that_cannot_be_replaced_is_reported_after_the_bounded_retry() {
    // Windows refuses to rename over a file another process holds open, and the retry turns that
    // into a delay. It must still give up: a write that retried forever would hang the caller.
    let dir = temp_dir();
    let occupied = dir.path().join("user-settings.json");
    std::fs::create_dir(&occupied).expect("a directory where the file should be");

    let outcome = StdFs.write_atomic(&occupied, "{}");

    assert!(
        matches!(outcome, Err(FsError::ReplaceExhausted { attempts: 5, .. })),
        "expected the replace to be given up on, got {outcome:?}"
    );
}

#[test]
fn a_lock_error_is_reported_at_once_rather_than_retried_until_the_deadline() {
    // `flock` fails outright only for a bad descriptor or an exhausted kernel lock table — neither
    // provokable from a real file — so the attempt is handed in. Retrying such a failure would
    // report contention that never existed, after a ten-second wait.
    use fs4::TryLockError;

    let dir = temp_dir();
    let mut attempts = 0;
    let outcome = cdc_runtime_host_native::fs::poll_for_lock(
        &dir.path().join("user-settings.json.lock"),
        Duration::from_secs(30),
        &mut || {
            attempts += 1;
            Err(TryLockError::Error(std::io::Error::other("no locks left")))
        },
    );

    assert_eq!(attempts, 1, "a real error is not worth retrying");
    assert!(
        matches!(
            outcome,
            Err(FsError::Io {
                operation: "lock",
                ..
            })
        ),
        "got {outcome:?}"
    );
}

#[test]
fn a_lock_that_is_contended_throughout_times_out() {
    use fs4::TryLockError;

    let dir = temp_dir();
    let mut attempts = 0;

    let outcome = cdc_runtime_host_native::fs::poll_for_lock(
        &dir.path().join("user-settings.json.lock"),
        Duration::from_millis(20),
        &mut || {
            attempts += 1;
            Err(TryLockError::WouldBlock)
        },
    );

    assert!(
        attempts > 1,
        "contention is retried, not given up on at once"
    );
    assert!(
        matches!(outcome, Err(FsError::LockTimeout { .. })),
        "got {outcome:?}"
    );
}

#[test]
fn the_system_clock_reports_wall_time_and_moves() {
    use cdc_runtime::capabilities::clock::Clock;

    let before = cdc_runtime_host_native::fs::SystemClock.now_millis();
    thread::sleep(Duration::from_millis(5));
    let after = cdc_runtime_host_native::fs::SystemClock.now_millis();

    assert!(after > before, "{after} should be later than {before}");
    assert!(
        before > 1_700_000_000_000,
        "milliseconds since the epoch, not since an arbitrary origin: {before}"
    );
}

#[test]
fn reading_a_directory_as_a_file_is_an_error_not_an_absence() {
    // `None` means "not there yet, start from {}". A directory in the way must not read as that,
    // or a misconfigured path would silently produce an empty configuration.
    let dir = temp_dir();
    let outcome = StdFs.read_to_string(dir.path());
    assert!(
        matches!(outcome, Err(FsError::Io { .. })),
        "expected an I/O error, got {outcome:?}"
    );
    assert!(Path::new(dir.path()).is_dir());
}

/// `is_file_present` and `mkdir` — the two operations the connection lifecycle needs and the settings
/// document does not.
///
/// `mkdir` is recursive because every call site in the original passes `{ recursive: true }`, and it
/// must be idempotent: a native `startApi` creates the socket's base directory on every attempt, so a
/// second connect to the same engine would fail on an already-existing directory.
#[test]
fn a_directory_is_created_recursively_and_creating_it_twice_is_not_an_error() {
    let home = tempfile::tempdir().expect("a temporary directory");
    let nested = home
        .path()
        .join("run")
        .join("user")
        .join("1000")
        .join("podman");

    assert!(
        !StdFs.is_file_present(&nested),
        "nothing is there before it is created"
    );

    StdFs
        .mkdir(&nested)
        .expect("the whole chain is created at once");
    assert!(StdFs.is_file_present(&nested));

    StdFs
        .mkdir(&nested)
        .expect("creating it again is what every reconnect does");
}

#[test]
fn a_file_is_present_and_a_path_that_was_never_written_is_not() {
    let home = tempfile::tempdir().expect("a temporary directory");
    let socket = home.path().join("podman.sock");

    assert!(!StdFs.is_file_present(&socket));
    StdFs
        .write_atomic(&socket, "")
        .expect("writing the file makes it present");

    assert!(StdFs.is_file_present(&socket));
}

/// A named pipe is asked of the pipe FILESYSTEM, and a path that merely looks like one is not.
///
/// `Path::exists` cannot answer for a pipe — it opens the path, which for a pipe means becoming a
/// client of it, so the answer is racy, destructive, and `false` for a healthy engine whose instances
/// are all busy (measured against a live Docker Desktop on Windows 11). This host therefore routes a
/// pipe address to an enumeration of `\\.\pipe\` instead.
///
/// What can be pinned HERE is the routing, because this suite runs on POSIX where that directory does
/// not exist: a pipe address answers `false` without touching the disk, and — the assertion that
/// distinguishes a strict predicate from a loose one — a real directory called `pipe` is NOT routed
/// that way and still answers for itself. The Windows behaviour of the enumeration is not reachable
/// from a Linux gate and is
#[test]
fn a_pipe_address_is_answered_by_enumeration_and_a_posix_pipe_directory_is_not() {
    assert!(
        !StdFs.is_file_present(Path::new(r"\\.\pipe\dockerDesktopLinuxEngine")),
        "there is no pipe filesystem here, and nothing was opened to find that out"
    );

    let home = tempfile::tempdir().expect("a temporary directory");
    let posix_pipe = home.path().join("pipe").join("socket");
    StdFs.mkdir(&posix_pipe).expect("a directory named pipe");

    assert!(
        StdFs.is_file_present(&posix_pipe),
        "a POSIX path with a `pipe` directory in it is a path, not a named pipe — routing it to the \
         enumeration would answer false for something that is plainly there"
    );
}

/// The matcher the pipe check is built on, exercised against a directory this platform HAS.
///
/// `\\.\pipe\` exists only on Windows, so without a directory parameter not one line of this could
/// run in a gate here — and a matcher nothing executes is where case-insensitivity quietly stops
/// being case-insensitive. Windows pipe names are case-insensitive, so `Docker_Engine` and
/// `docker_engine` are the same pipe, and a probe that missed that would report a running engine as
/// absent for a difference the operating system does not recognise.
#[test]
fn an_entry_is_matched_case_insensitively_and_a_directory_that_is_not_there_answers_no() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    StdFs
        .write_atomic(&directory.path().join("Docker_Engine"), "")
        .expect("an entry named like a pipe");

    assert!(entry_is_listed(directory.path(), "docker_engine"));
    assert!(entry_is_listed(directory.path(), "DOCKER_ENGINE"));
    assert!(
        !entry_is_listed(directory.path(), "docker_engin"),
        "a prefix is a different pipe"
    );
    assert!(
        !entry_is_listed(directory.path(), "podman-machine-default"),
        "an entry that is not there"
    );
    assert!(
        !entry_is_listed(&directory.path().join("absent"), "docker_engine"),
        "a directory that cannot be read is every call off Windows"
    );
}
