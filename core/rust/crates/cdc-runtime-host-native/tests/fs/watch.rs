//! External change detection.
//!
//! A connection added in the desktop app must appear here without a restart. The debounce is not a
//! nicety: the atomic-rename write pattern produces several filesystem events per logical write, so
//! an undebounced watcher reloads two or three times for every single edit — and can reload while
//! the temporary file is still the newest thing in the directory.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::settings::watch::SettingsWatcher;
use cdc_runtime_host_native::fs::StdFs;

const DEBOUNCE: Duration = Duration::from_millis(200);

/// Time as data, so the debounce is checked rather than waited for.
///
/// An atomic rather than a `Cell` because `Clock` is `Send + Sync`: one clock is handed to every
/// connection a server owns, across threads. Nothing here is threaded, and the bound still applies.
#[derive(Default)]
struct FakeClock(AtomicU64);

impl FakeClock {
    fn advance(&self, millis: u64) {
        self.0.fetch_add(millis, Ordering::SeqCst);
    }
}

impl Clock for &FakeClock {
    fn now_millis(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
}

impl Fixture {
    fn new(contents: &str) -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let path = dir.path().join("user-settings.json");
        std::fs::write(&path, contents).expect("seed the fixture");
        Self { _dir: dir, path }
    }

    fn write(&self, contents: &str) {
        // Sleep past the filesystem's timestamp granularity; the point under test is the debounce,
        // not how finely this filesystem stamps mtimes.
        std::thread::sleep(Duration::from_millis(10));
        std::fs::write(&self.path, contents).expect("external write");
    }
}

#[test]
fn a_quiet_file_reports_nothing() {
    let fixture = Fixture::new(r#"{"theme":"dark"}"#);
    let clock = FakeClock::default();
    let mut watcher = SettingsWatcher::new(StdFs, &clock, &fixture.path, DEBOUNCE);
    watcher.prime().expect("prime");

    clock.advance(10_000);
    assert!(watcher.poll().expect("poll").is_none());
}

#[test]
fn a_change_is_reported_only_after_the_window_has_passed() {
    let fixture = Fixture::new(r#"{"theme":"dark"}"#);
    let clock = FakeClock::default();
    let mut watcher = SettingsWatcher::new(StdFs, &clock, &fixture.path, DEBOUNCE);
    watcher.prime().expect("prime");

    fixture.write(r#"{"theme":"light"}"#);
    assert!(
        watcher.poll().expect("poll").is_none(),
        "reloading immediately would race the writer's rename"
    );

    clock.advance(DEBOUNCE.as_millis() as u64);
    let reloaded = watcher.poll().expect("poll").expect("a change is reported");
    assert_eq!(
        reloaded.as_value().get("theme"),
        Some(&serde_json::json!("light"))
    );

    clock.advance(10_000);
    assert!(
        watcher.poll().expect("poll").is_none(),
        "a change is reported once, not on every poll thereafter"
    );
}

#[test]
fn a_burst_of_writes_collapses_into_one_reload() {
    // The atomic write emits create, write and rename. Each restarts the quiet period, so the
    // watcher reloads once, at the end, with the final contents.
    let fixture = Fixture::new(r#"{"n":0}"#);
    let clock = FakeClock::default();
    let mut watcher = SettingsWatcher::new(StdFs, &clock, &fixture.path, DEBOUNCE);
    watcher.prime().expect("prime");

    let mut reloads = 0;
    for step in 1..=3 {
        fixture.write(&format!(r#"{{"n":{step}}}"#));
        clock.advance(50);
        if watcher.poll().expect("poll").is_some() {
            reloads += 1;
        }
    }
    assert_eq!(reloads, 0, "nothing settles while writes keep arriving");

    clock.advance(DEBOUNCE.as_millis() as u64);
    let reloaded = watcher
        .poll()
        .expect("poll")
        .expect("the burst settles once");
    assert_eq!(reloaded.as_value().get("n"), Some(&serde_json::json!(3)));
}

#[test]
fn a_rewrite_with_identical_contents_is_not_a_change() {
    // `touch`, or a write that happens to produce the same bytes. Reporting it would make every
    // consumer rebuild its state for nothing.
    let fixture = Fixture::new(r#"{"theme":"dark"}"#);
    let clock = FakeClock::default();
    let mut watcher = SettingsWatcher::new(StdFs, &clock, &fixture.path, DEBOUNCE);
    watcher.prime().expect("prime");

    fixture.write(r#"{"theme":"dark"}"#);
    assert!(
        watcher.poll().expect("poll").is_none(),
        "the poll that observes the change starts the quiet period"
    );

    clock.advance(DEBOUNCE.as_millis() as u64);
    assert!(
        watcher.poll().expect("poll").is_none(),
        "the window has passed and the timestamp moved, but the bytes did not"
    );
}

#[test]
fn a_file_that_appears_later_is_reported() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let path = dir.path().join("user-settings.json");
    let clock = FakeClock::default();
    let mut watcher = SettingsWatcher::new(StdFs, &clock, &path, DEBOUNCE);
    watcher.prime().expect("prime an absent file");

    std::fs::write(&path, r#"{"theme":"dark"}"#).expect("write");
    assert!(
        watcher.poll().expect("poll").is_none(),
        "the poll that observes the change starts the quiet period"
    );
    clock.advance(DEBOUNCE.as_millis() as u64);
    assert!(watcher.poll().expect("poll").is_some());
}

#[test]
fn a_corrupt_reload_is_an_error_rather_than_silence() {
    // Silence would look identical to "no change", and the caller would keep serving connections
    // from a document the user can see is broken.
    let fixture = Fixture::new(r#"{"theme":"dark"}"#);
    let clock = FakeClock::default();
    let mut watcher = SettingsWatcher::new(StdFs, &clock, &fixture.path, DEBOUNCE);
    watcher.prime().expect("prime");

    fixture.write("{ half written");
    assert!(watcher.poll().expect("poll").is_none());
    clock.advance(DEBOUNCE.as_millis() as u64);
    assert!(watcher.poll().is_err());
}
