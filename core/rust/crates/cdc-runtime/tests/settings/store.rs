//! The locked read-modify-write path, over a filesystem that is a `HashMap`.
//!
//! The rules asserted here are the store's own and hold on every target: every mutation takes the lock
//! and re-reads inside it, a read takes no lock and writes nothing, and the legacy migration is a WRITE
//! and must therefore go through the same path.
//!
//! What only a real filesystem can settle — atomic replacement, the app's exact formatting, two OS
//! processes contending for an advisory lock — stays in `cdc-runtime-host-native/tests/settings_store.rs`.

use std::path::Path;
use std::time::Duration;

use crate::fakes::MemoryFs;
use cdc_runtime::settings::store::{SettingsStore, lock_path_for};
use serde_json::{Value, json};

const APP_VERSION: &str = "5.2.20";
const PATH: &str = "/cdc/settings/user-settings.json";

const FIXTURE: &str = r#"{
  "theme": "dark",
  "connections": [],
  "ai": {
    "enabled": true
  },
  "version": "5.2.19"
}"#;

fn store(fs: MemoryFs) -> SettingsStore<MemoryFs> {
    SettingsStore::new(fs, PATH, APP_VERSION)
}

fn on_disk(fs: &MemoryFs) -> Value {
    serde_json::from_str(&fs.read(PATH).expect("the file exists")).expect("the file is JSON")
}

/// A whole connection, because `connections()` reads them as the generated types — a partial one would
/// fail to parse rather than proving anything about the read.
fn connection(id: &str) -> Value {
    json!({
      "id": id,
      "name": "Podman",
      "label": "Native",
      "host": "podman.native",
      "engine": "podman",
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": "/run/podman.sock", "relay": "" } },
        "program": { "name": "podman", "path": "/usr/bin/podman" },
        "rootfull": false,
        "mode": "mode.automatic"
      }
    })
}

#[test]
fn an_absent_file_reads_as_an_empty_document() {
    // A path that does not exist is a fresh installation, not an error — anything else would make the
    // first run of the app a failure.
    let fs = MemoryFs::default();

    assert!(
        store(fs.clone())
            .read()
            .expect("read succeeds")
            .connections_value()
            .is_empty()
    );
    assert_eq!(fs.writes(), 0, "a read never writes");
    assert_eq!(fs.locks_taken(), 0, "and never locks");
}

#[test]
fn a_created_connection_reaches_the_file_under_the_lock() {
    let fs = MemoryFs::seeded(PATH, FIXTURE);

    store(fs.clone())
        .create_connection(&connection("host.a.podman.native"))
        .expect("create");

    assert_eq!(
        on_disk(&fs)["connections"][0]["id"],
        json!("host.a.podman.native")
    );
    assert_eq!(on_disk(&fs)["version"], json!(APP_VERSION));
    assert_eq!(fs.writes(), 1);
    assert_eq!(fs.locks_taken(), 1, "the write took the lock");
}

#[test]
fn an_update_and_a_removal_each_reach_the_file_rather_than_reporting_success() {
    // Three mutations, one write path. An arm that reported `Ok` without writing would leave the user's
    // change on screen and not on disk.
    let fs = MemoryFs::seeded(PATH, FIXTURE);
    let store = store(fs.clone());
    store
        .create_connection(&connection("host.a.podman.native"))
        .expect("create");

    store
        .update_connection("host.a.podman.native", &json!({ "name": "renamed" }))
        .expect("update");
    assert_eq!(on_disk(&fs)["connections"][0]["name"], json!("renamed"));

    store
        .remove_connection("host.a.podman.native")
        .expect("remove");
    assert_eq!(on_disk(&fs)["connections"], json!([]));

    assert_eq!(fs.locks_taken(), 3, "every mutation locked");
    assert_eq!(on_disk(&fs)["ai"], json!({ "enabled": true }));
    assert_eq!(
        on_disk(&fs)["theme"],
        json!("dark"),
        "the user's unmodelled keys survive a full CRUD cycle"
    );
}

#[test]
fn a_current_document_is_read_without_being_rewritten() {
    // The migration path writes; the ordinary one must not. A read that took the lock and rewrote the
    // file on every startup would churn the user's configuration for nothing.
    let fs = MemoryFs::seeded(PATH, FIXTURE);
    store(fs.clone())
        .create_connection(&connection("host.a.podman.native"))
        .expect("create");
    let writes_after_create = fs.writes();

    let connections = store(fs.clone()).connections().expect("read connections");

    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].id, "host.a.podman.native");
    assert_eq!(
        fs.writes(),
        writes_after_create,
        "reading a document that needs no migration must not write"
    );
}

#[test]
fn a_legacy_document_is_migrated_on_read_and_persisted_through_the_lock() {
    // `runtime`/`engine` were renamed to `engine`/`host`. The migration writes, so it must go through
    // the locked path rather than the caller's own — and it must actually reach the file, or every
    // startup would migrate the same document again.
    let legacy = json!({
      "connections": [{
        "id": "host.a.podman.native",
        "name": "Podman",
        "label": "Native",
        "runtime": "podman",
        "engine": "podman.native",
        "settings": {
          "api": { "baseURL": "http://d", "connection": { "uri": "/run/podman.sock", "relay": "" } },
          "program": { "name": "podman", "path": "/usr/bin/podman" },
          "rootfull": false,
          "mode": "mode.automatic"
        }
      }],
      "ai": { "enabled": true }
    });
    let fs = MemoryFs::seeded(PATH, &legacy.to_string());

    let connections = store(fs.clone()).connections().expect("read connections");

    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].engine.to_string(), "podman");
    assert_eq!(connections[0].host.to_string(), "podman.native");
    assert_eq!(on_disk(&fs)["connections"][0]["runtime"], Value::Null);
    assert_eq!(on_disk(&fs)["ai"], json!({ "enabled": true }));
    assert!(fs.writes() >= 1, "the migration was persisted");
    assert!(fs.locks_taken() >= 1, "and it went through the lock");
}

#[test]
fn a_corrupt_file_is_refused_rather_than_overwritten() {
    let fs = MemoryFs::seeded(PATH, "{ this is not json");
    let store = store(fs.clone());

    assert!(store.read().is_err());
    assert!(store.connections().is_err());
    assert!(
        store
            .create_connection(&connection("host.a.podman.native"))
            .is_err()
    );
    assert_eq!(
        fs.read(PATH).as_deref(),
        Some("{ this is not json"),
        "the user's file must be left exactly as it was found"
    );
    assert_eq!(fs.writes(), 0);
}

#[test]
fn a_lock_that_cannot_be_taken_stops_the_write_instead_of_proceeding_without_it() {
    // The lock is not advisory-and-optional: a mutation that could not take it must fail, because the
    // re-read inside it is the only thing making concurrent writers safe.
    let fs = MemoryFs::seeded(PATH, FIXTURE);
    fs.hold_lock(lock_path_for(Path::new(PATH)));

    let outcome = store(fs.clone())
        .with_lock_timeout(Duration::from_millis(50))
        .create_connection(&connection("host.a.podman.native"));

    assert!(outcome.is_err(), "a contended write must not proceed");
    assert_eq!(fs.writes(), 0, "and must not have touched the file");
}

#[test]
fn the_lockfile_is_a_sibling_of_the_document_it_protects() {
    // A sibling, so it shares the target's directory and therefore its filesystem: a lock on a
    // different filesystem is a lock two writers can both take.
    assert_eq!(
        lock_path_for(Path::new("/home/u/.config/cd/user-settings.json")),
        Path::new("/home/u/.config/cd/user-settings.json.lock")
    );
    // `parent()` of a bare filename is `Some("")`, not `None`, which is why the fallback is spelled.
    assert_eq!(
        lock_path_for(Path::new("user-settings.json")),
        Path::new("user-settings.json.lock")
    );
    // A path with no filename at all still names a lockfile rather than the directory itself. `/` has
    // no `file_name` AND no `parent`, so both fallbacks fire at once — the only input where they do.
    assert_eq!(lock_path_for(Path::new("/")), Path::new("./.lock"));
}
