//! Noticing that someone else changed `user-settings.json`, on a virtual clock.
//!
//! Every rule here is a boundary, and each boundary is a place a comparison can be one step out: the
//! stamp moved or it did not, the quiet period has elapsed or it has not, the CONTENTS changed or only
//! the stamp did. A fake filesystem and a fake clock make all three exact, where a real filesystem's
//! timestamp granularity makes them flaky.
//!
//! The equivalent over the real filesystem is `cdc-runtime-host-native/tests/settings_watch.rs`.

use std::time::Duration;

use crate::fakes::{FakeClock, MemoryFs};
use cdc_runtime::domain::settings::document::SettingsDocument;
use cdc_runtime::settings::store::SettingsError;
use cdc_runtime::settings::watch::SettingsWatcher;

const PATH: &str = "/cdc/settings/user-settings.json";
const DEBOUNCE_MS: u64 = 200;

const ONE: &str = r#"{ "theme": "dark", "connections": [] }"#;
const TWO: &str = r#"{ "theme": "light", "connections": [] }"#;

fn watcher(fs: &MemoryFs, clock: &FakeClock) -> SettingsWatcher<MemoryFs, FakeClock> {
    let mut watcher = SettingsWatcher::new(
        fs.clone(),
        clock.clone(),
        PATH,
        Duration::from_millis(DEBOUNCE_MS),
    );
    watcher.prime().expect("priming reads the starting state");
    watcher
}

/// Poll, let the quiet period elapse, poll again — which is the whole debounce in two calls.
///
/// Two polls exactly, never a loop: the first NOTICES the change and starts the window, the second
/// reports it. A loop would let a watcher that needed a third poll pass unnoticed.
fn settled(
    watcher: &mut SettingsWatcher<MemoryFs, FakeClock>,
    clock: &FakeClock,
) -> Result<Option<SettingsDocument>, SettingsError> {
    assert!(
        watcher.poll()?.is_none(),
        "a change is never reported in the same poll that noticed it"
    );
    clock.advance(DEBOUNCE_MS);
    watcher.poll()
}

#[test]
fn a_quiet_file_reports_nothing_however_often_it_is_polled() {
    let fs = MemoryFs::seeded(PATH, ONE);
    let clock = FakeClock::default();
    let mut watcher = watcher(&fs, &clock);

    for tick in 0..5 {
        clock.advance(DEBOUNCE_MS * 2);
        assert!(
            watcher.poll().expect("poll succeeds").is_none(),
            "nothing changed, so poll {tick} must report nothing"
        );
    }
}

#[test]
fn a_change_is_reported_once_the_quiet_period_has_elapsed_and_not_before() {
    let fs = MemoryFs::seeded(PATH, ONE);
    let clock = FakeClock::default();
    let mut watcher = watcher(&fs, &clock);

    fs.put(PATH, TWO);
    assert!(
        watcher.poll().expect("poll succeeds").is_none(),
        "the change was seen but the file may still be settling"
    );

    clock.advance(DEBOUNCE_MS - 1);
    assert!(
        watcher.poll().expect("poll succeeds").is_none(),
        "one millisecond short of the window is still settling"
    );

    clock.advance(1);
    let document = watcher
        .poll()
        .expect("poll succeeds")
        .expect("the window has elapsed exactly");
    assert_eq!(document.connections_value().len(), 0);

    assert!(
        watcher.poll().expect("poll succeeds").is_none(),
        "reported exactly once per settled change"
    );
}

#[test]
fn a_change_older_than_the_window_is_reported_rather_than_held_back() {
    // The comparison is "elapsed < debounce", so it has to be right at the boundary AND beyond it: a
    // watcher polled rarely (a server tick, a resumed laptop) sees a change long past its window.
    let fs = MemoryFs::seeded(PATH, ONE);
    let clock = FakeClock::default();
    let mut watcher = watcher(&fs, &clock);

    fs.put(PATH, TWO);
    watcher.poll().expect("poll succeeds");
    clock.advance(DEBOUNCE_MS * 100);

    assert!(
        watcher.poll().expect("poll succeeds").is_some(),
        "a long-settled change must not be swallowed"
    );
}

#[test]
fn a_burst_of_writes_collapses_into_one_reload() {
    // A trailing edge: each observed change restarts the quiet period, so the several filesystem events
    // one atomic write produces settle into exactly one reload.
    let fs = MemoryFs::seeded(PATH, ONE);
    let clock = FakeClock::default();
    let mut watcher = watcher(&fs, &clock);

    for step in 0..5 {
        fs.put(PATH, &format!(r#"{{ "theme": "dark", "step": {step} }}"#));
        clock.advance(DEBOUNCE_MS / 2);
        assert!(
            watcher.poll().expect("poll succeeds").is_none(),
            "write {step} restarted the window rather than reporting"
        );
    }

    clock.advance(DEBOUNCE_MS);
    assert!(watcher.poll().expect("poll succeeds").is_some());
    assert!(
        watcher.poll().expect("poll succeeds").is_none(),
        "one reload for the whole burst"
    );
}

#[test]
fn a_rewrite_with_identical_contents_is_not_a_change() {
    // A `touch`, or a write that produced identical bytes, moves the stamp without changing anything.
    // Reporting it would make every consumer rebuild its state for nothing.
    let fs = MemoryFs::seeded(PATH, ONE);
    let clock = FakeClock::default();
    let mut watcher = watcher(&fs, &clock);

    fs.touch(PATH);

    assert!(
        settled(&mut watcher, &clock)
            .expect("poll succeeds")
            .is_none(),
        "the timestamp moved, the contents did not"
    );
}

#[test]
fn a_change_after_an_identical_rewrite_is_still_reported() {
    // The stamp is remembered even when the contents are not reported, so the NEXT real change must
    // still be noticed — a watcher that forgot it would go blind after one `touch`.
    let fs = MemoryFs::seeded(PATH, ONE);
    let clock = FakeClock::default();
    let mut watcher = watcher(&fs, &clock);
    fs.touch(PATH);
    assert!(
        settled(&mut watcher, &clock)
            .expect("poll succeeds")
            .is_none(),
        "the touch itself is not a change"
    );

    fs.put(PATH, TWO);

    assert!(
        settled(&mut watcher, &clock)
            .expect("poll succeeds")
            .is_some()
    );
}

#[test]
fn a_file_that_appears_later_is_reported() {
    // A fresh installation has no settings file at all, and the first write to it is a change like any
    // other: `None` and `Some(stamp)` differ.
    let fs = MemoryFs::default();
    let clock = FakeClock::default();
    let mut watcher = watcher(&fs, &clock);

    fs.put(PATH, ONE);

    let document = settled(&mut watcher, &clock)
        .expect("poll succeeds")
        .expect("a file appearing is a change");
    assert!(document.connections_value().is_empty());
}

#[test]
fn a_corrupt_reload_is_an_error_rather_than_silence() {
    // Half-written JSON must not be reported as an empty document: that would look like the user
    // deleting every connection they have.
    let fs = MemoryFs::seeded(PATH, ONE);
    let clock = FakeClock::default();
    let mut watcher = watcher(&fs, &clock);

    fs.put(PATH, "{ this is not json");

    assert!(settled(&mut watcher, &clock).is_err());
}

#[test]
fn priming_a_watcher_reports_the_state_it_starts_from() {
    // `prime` exists so the first poll reports a change only if one really happened afterwards, which
    // means it has to hand back what it saw — a caller with no starting document would have to read the
    // file itself, outside the capability.
    let fs = MemoryFs::seeded(PATH, TWO);
    let clock = FakeClock::default();
    let mut watcher = SettingsWatcher::new(
        fs.clone(),
        clock.clone(),
        PATH,
        Duration::from_millis(DEBOUNCE_MS),
    );

    let document = watcher.prime().expect("priming reads the file");

    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&document.to_json()).expect("valid JSON"),
        serde_json::from_str::<serde_json::Value>(TWO).expect("valid JSON"),
        "priming hands back what it read, reformatted as the app writes it"
    );
    clock.advance(DEBOUNCE_MS * 2);
    assert!(
        watcher.poll().expect("poll succeeds").is_none(),
        "priming is not itself a change"
    );
}
