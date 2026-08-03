//! The locked read-modify-write path over the real filesystem.
//!
//! The order is the whole point: lock, then **re-read inside the lock**, then mutate, then replace
//! atomically. A document read before the lock is already stale, and that is the step easiest to
//! omit — so `two_writers_never_lose_an_update` exists to make omitting it fail.

use std::thread;
use std::time::Duration;

use cdc_runtime::settings::store::SettingsStore;
use cdc_runtime_host_native::fs::StdFs;
use serde_json::{Value, json};

const APP_VERSION: &str = "5.2.20";

const FIXTURE: &str = r#"{
  "theme": "dark",
  "connections": [],
  "ai": {
    "enabled": true,
    "providers": [
      {
        "id": "openai",
        "models": [
          "gpt-5"
        ]
      }
    ]
  },
  "version": "5.2.19"
}"#;

struct Fixture {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
}

impl Fixture {
    fn new(contents: Option<&str>) -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let path = dir.path().join("user-settings.json");
        if let Some(contents) = contents {
            std::fs::write(&path, contents).expect("seed the fixture");
        }
        Self { _dir: dir, path }
    }

    fn store(&self) -> SettingsStore<StdFs> {
        SettingsStore::new(StdFs, &self.path, APP_VERSION)
    }

    fn on_disk(&self) -> Value {
        let text = std::fs::read_to_string(&self.path).expect("read the settings file");
        serde_json::from_str(&text).expect("the settings file is JSON")
    }
}

fn connection(id: &str) -> Value {
    json!({
      "id": id,
      "name": id,
      "label": "Native",
      "host": "podman.native",
      "engine": "podman",
      "settings": { "rootfull": false, "mode": "mode.manual" }
    })
}

#[test]
fn an_absent_file_reads_as_an_empty_document() {
    let fixture = Fixture::new(None);
    assert!(
        fixture
            .store()
            .read()
            .expect("read succeeds")
            .connections_value()
            .is_empty()
    );
}

#[test]
fn a_created_connection_reaches_the_file() {
    let fixture = Fixture::new(Some(FIXTURE));
    fixture
        .store()
        .create_connection(&connection("host.a.podman.native"))
        .expect("create");

    assert_eq!(
        fixture.on_disk()["connections"][0]["id"],
        json!("host.a.podman.native")
    );
    assert_eq!(fixture.on_disk()["version"], json!(APP_VERSION));
}

#[test]
fn the_users_unmodelled_keys_survive_a_full_crud_cycle() {
    // The reason the design exists. `ai` is never modelled by the core and must come back byte for
    // byte after the file has been rewritten three times.
    let fixture = Fixture::new(Some(FIXTURE));
    let before = fixture.on_disk()["ai"].clone();
    let store = fixture.store();

    store
        .create_connection(&connection("host.a.podman.native"))
        .expect("create");
    store
        .update_connection("host.a.podman.native", &json!({ "name": "renamed" }))
        .expect("update");
    assert_eq!(
        fixture.on_disk()["connections"][0]["name"],
        json!("renamed"),
        "the update reached the file, rather than being reported as done"
    );
    store
        .remove_connection("host.a.podman.native")
        .expect("remove");

    assert_eq!(fixture.on_disk()["ai"], before);
    assert_eq!(fixture.on_disk()["theme"], json!("dark"));
    assert_eq!(fixture.on_disk()["connections"], json!([]));
}

#[test]
fn the_file_keeps_the_apps_formatting() {
    // Two-space indent, no trailing newline — JSON.stringify(config, null, 2). A different shape
    // rewrites every line of the user's file the first time the core touches it.
    let fixture = Fixture::new(Some(FIXTURE));
    fixture
        .store()
        .create_connection(&connection("host.a.podman.native"))
        .expect("create");

    let text = std::fs::read_to_string(&fixture.path).expect("read");
    assert!(text.starts_with("{\n  \"theme\": \"dark\","), "got: {text}");
    assert!(!text.ends_with('\n'), "no trailing newline is added");
}

#[test]
fn a_legacy_document_is_migrated_on_read_and_persisted() {
    // The migration writes, so it must go through the locked path rather than the caller's own.
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
    let fixture = Fixture::new(Some(&legacy.to_string()));

    let connections = fixture.store().connections().expect("read connections");

    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].engine.to_string(), "podman");
    assert_eq!(connections[0].host.to_string(), "podman.native");
    assert_eq!(fixture.on_disk()["connections"][0]["runtime"], Value::Null);
    assert_eq!(fixture.on_disk()["ai"], json!({ "enabled": true }));
}

#[test]
fn a_current_document_is_read_without_being_rewritten() {
    // The migration path writes; the ordinary one must not. A read that took the lock and rewrote
    // the file on every startup would churn the user's configuration for nothing.
    // A whole connection, because `connections()` reads them as the generated types: the partial one
    // the write tests use would fail to parse rather than proving anything about the read.
    let fixture = Fixture::new(Some(FIXTURE));
    fixture
        .store()
        .create_connection(&json!({
          "id": "host.a.podman.native",
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
        }))
        .expect("create");
    let before = std::fs::read_to_string(&fixture.path).expect("read");

    let connections = fixture.store().connections().expect("read connections");

    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].id, "host.a.podman.native");
    assert_eq!(
        std::fs::read_to_string(&fixture.path).expect("read"),
        before,
        "reading a document that needs no migration must not write"
    );
}

#[test]
fn a_corrupt_file_is_refused_rather_than_overwritten() {
    let fixture = Fixture::new(Some("{ this is not json"));
    let store = fixture.store();

    assert!(store.read().is_err());
    assert!(
        store
            .create_connection(&connection("host.a.podman.native"))
            .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(&fixture.path).expect("read"),
        "{ this is not json",
        "the user's file must be left exactly as it was found"
    );
}

#[test]
fn two_writers_never_lose_an_update() {
    // Two threads, separate store instances, 50 connections each. Read-modify-write without the
    // lock loses updates here; with lock-then-RE-READ, all 100 survive. Verified by breaking it:
    // dropping the lock, or reading the document before taking it, fails this test.
    const PER_WRITER: usize = 50;
    let fixture = Fixture::new(Some(FIXTURE));

    let writers: Vec<_> = ["a", "b"]
        .into_iter()
        .map(|writer| {
            let path = fixture.path.clone();
            thread::spawn(move || {
                let store = SettingsStore::new(StdFs, &path, APP_VERSION)
                    .with_lock_timeout(Duration::from_secs(30));
                for index in 0..PER_WRITER {
                    store
                        .create_connection(&connection(&format!(
                            "host.{writer}{index}.podman.native"
                        )))
                        .expect("create under contention");
                }
            })
        })
        .collect();
    for writer in writers {
        writer.join().expect("writer finishes");
    }

    let on_disk = fixture.on_disk();
    let ids: Vec<&str> = on_disk["connections"]
        .as_array()
        .expect("connections is an array")
        .iter()
        .filter_map(|it| it["id"].as_str())
        .collect();
    assert_eq!(ids.len(), PER_WRITER * 2, "every write must survive");
    for writer in ["a", "b"] {
        for index in 0..PER_WRITER {
            let expected = format!("host.{writer}{index}.podman.native");
            assert!(ids.contains(&expected.as_str()), "{expected} was lost");
        }
    }
}

#[test]
fn a_held_lock_makes_a_write_report_contention_rather_than_proceeding() {
    use cdc_runtime::capabilities::fs::FsLocks;

    let fixture = Fixture::new(Some(FIXTURE));
    let held = StdFs
        .lock_exclusive(
            &cdc_runtime::settings::store::lock_path_for(&fixture.path),
            Duration::from_secs(5),
        )
        .expect("hold the lock");

    let store = fixture.store().with_lock_timeout(Duration::from_millis(50));
    let outcome = store.create_connection(&connection("host.a.podman.native"));

    assert!(outcome.is_err(), "a contended write must not proceed");
    assert_eq!(
        fixture.on_disk()["connections"],
        json!([]),
        "and must not have touched the file"
    );
    drop(held);
}
