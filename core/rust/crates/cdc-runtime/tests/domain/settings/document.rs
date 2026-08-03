//! `user-settings.json` as a document.
//!
//! The oracle is `Application.getConnectionsFromConfiguration` / `createConnection` /
//! `updateConnection` / `removeConnection` plus `UserConfiguration.setKey` in
//! `src/packages/container-client/src/{Application,config}.ts`.
//!
//! The hazard these tests exist for: the file is shared with the shipping desktop app and holds the
//! user's `ai` configuration. An implementation that deserialized it into a struct and serialized it
//! back would delete every key it does not model, on the first connection edit.

use cdc_runtime::domain::settings::document::{DocumentError, SettingsDocument};
use serde_json::{Value, json};

// A realistic document: unmodelled top-level keys (`ai`, `window`, `wizard`), an unmodelled
// per-connection key (`scopes`), and keys deliberately out of alphabetical order.
//
// Laid out exactly as `JSON.stringify(config, null, 2)` emits it, because
// `the_document_round_trips_byte_identically_when_nothing_is_written` compares against it.
const FIXTURE: &str = r#"{
  "theme": "dark",
  "connections": [
    {
      "id": "host.aaa.podman.native",
      "name": "Podman",
      "label": "Native",
      "host": "podman.native",
      "engine": "podman",
      "settings": {
        "api": {
          "baseURL": "http://d",
          "connection": {
            "uri": "/run/podman.sock",
            "relay": ""
          }
        },
        "program": {
          "name": "podman",
          "path": "/usr/bin/podman",
          "version": "5.6.2"
        },
        "rootfull": false,
        "mode": "mode.automatic"
      },
      "scopes": []
    }
  ],
  "connector": {
    "default": "host.aaa.podman.native"
  },
  "ai": {
    "enabled": true,
    "providers": [
      {
        "id": "openai",
        "models": [
          "gpt-5"
        ]
      }
    ],
    "permissions": {
      "ask": "always"
    }
  },
  "window": {
    "width": 1280,
    "height": 800
  },
  "wizard": {
    "skipAtStartup": true
  },
  "version": "5.2.19"
}"#;

fn fixture() -> SettingsDocument {
    SettingsDocument::parse(FIXTURE).expect("fixture parses")
}

fn ai_block(document: &SettingsDocument) -> String {
    serde_json::to_string_pretty(document.as_value().get("ai").expect("ai block is present"))
        .expect("ai block serializes")
}

fn new_connection() -> Value {
    json!({
      "id": "host.bbb.docker.native",
      "name": "Docker",
      "label": "Native",
      "host": "docker.native",
      "engine": "docker",
      "description": "added by the user",
      "settings": {
        "api": { "baseURL": "http://localhost", "connection": { "uri": "/var/run/docker.sock", "relay": "" } },
        "program": { "name": "docker", "path": "/usr/bin/docker", "version": "29.5.3" },
        "rootfull": false,
        "mode": "mode.manual"
      }
    })
}

#[test]
fn an_absent_file_reads_as_an_empty_document() {
    // `read()` in config.ts substitutes "{}" when the file is missing.
    let document = SettingsDocument::parse("{}").expect("empty object parses");
    assert!(document.connections_value().is_empty());
}

#[test]
fn a_corrupt_document_is_an_error_rather_than_an_empty_one() {
    // The app logs and continues with `{}`, which would overwrite the user's whole configuration on
    // the next write. A core that WRITES cannot do that — refusing is the only safe reading.
    assert!(matches!(
        SettingsDocument::parse("{ not json"),
        Err(DocumentError::Malformed { .. })
    ));
    assert!(matches!(
        SettingsDocument::parse("[]"),
        Err(DocumentError::NotAnObject)
    ));
}

#[test]
fn connections_are_read_as_generated_types() {
    let connections = fixture().connections().expect("connections parse");
    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].id, "host.aaa.podman.native");
    assert_eq!(connections[0].name, "Podman");
}

#[test]
fn a_pinned_context_survives_a_write_and_an_unpinned_one_writes_no_key() {
    // the design's field, through the design's rule. Two halves, and the second is the one that would
    // rewrite every user's file: `context` must not appear on a connection that has none, or the
    // first settings write this version makes would add a null to every entry in the document.
    let mut document = fixture();
    document.update_connection(
        "host.aaa.podman.native",
        &json!({ "settings": { "context": "desktop-linux" } }),
        "5.2.20",
    );

    let stored = &document.connections().expect("connections parse")[0];
    assert_eq!(stored.settings.context.as_deref(), Some("desktop-linux"));

    let mut fresh = fixture();
    fresh.create_connection(&new_connection(), "5.2.20");
    assert!(
        fresh.connections_value()[1]["settings"]
            .get("context")
            .is_none(),
        "a connection that pins nothing carries no key at all"
    );
}

#[test]
fn a_connection_that_is_not_one_is_refused_rather_than_skipped() {
    // The typed view is a READ of data the core does not own. An entry that cannot be a connection
    // must stop the read: silently dropping it would present the user with fewer connections than
    // their file contains, and the next write would then persist that shorter list.
    let document = SettingsDocument::parse(r#"{ "connections": [{ "id": 7 }] }"#)
        .expect("the document itself is valid JSON");

    let error = document
        .connections()
        .expect_err("an entry that is not a connection must not be skipped");

    assert!(
        matches!(error, DocumentError::Connections { .. }),
        "got {error}"
    );
    assert!(
        !document.connections_value().is_empty(),
        "the raw array is untouched — it is the typed view that refuses"
    );
}

#[test]
fn creating_a_connection_leaves_every_unmodelled_key_byte_identical() {
    let mut document = fixture();
    let before = ai_block(&document);

    document.create_connection(&new_connection(), "5.2.20");

    assert_eq!(
        ai_block(&document),
        before,
        "the user's AI block must survive"
    );
    assert_eq!(
        document.as_value().get("window"),
        Some(&json!({ "width": 1280, "height": 800 }))
    );
    assert_eq!(
        document.as_value().get("wizard"),
        Some(&json!({ "skipAtStartup": true }))
    );
}

#[test]
fn creating_a_connection_persists_only_six_fields_and_drops_description() {
    // Today's `createConnection` picks { id, name, label, host, engine, settings } — `description`
    // is deliberately dropped. It looks like a bug; the corpus records what the app DOES, and
    // changing it is a TypeScript-first change.
    let mut document = fixture();
    document.create_connection(&new_connection(), "5.2.20");

    let created = &document.connections_value()[1];
    let keys: Vec<&str> = created
        .as_object()
        .expect("connection is an object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["id", "name", "label", "host", "engine", "settings"]);
}

#[test]
fn creating_a_connection_keeps_unmodelled_keys_on_the_existing_entries() {
    // `scopes` is not in the connection schema. The array is rewritten wholesale on every write, so
    // an implementation that rebuilt it from typed values would silently drop this.
    let mut document = fixture();
    document.create_connection(&new_connection(), "5.2.20");

    assert_eq!(
        document.connections_value()[0].get("scopes"),
        Some(&json!([]))
    );
}

#[test]
fn every_write_stamps_the_application_version() {
    // `setKey` merges `{ version }` into the document on every write.
    let mut document = fixture();
    document.create_connection(&new_connection(), "5.2.20");
    assert_eq!(document.as_value().get("version"), Some(&json!("5.2.20")));
}

#[test]
fn updating_a_connection_deep_merges_the_partial() {
    let mut document = fixture();
    document.update_connection(
        "host.aaa.podman.native",
        &json!({ "settings": { "program": { "version": "5.7.0" } } }),
        "5.2.20",
    );

    let settings = document.connections_value()[0]
        .get("settings")
        .expect("settings survive");
    assert_eq!(
        settings.pointer("/program/version"),
        Some(&json!("5.7.0")),
        "the partial applies"
    );
    assert_eq!(
        settings.pointer("/program/path"),
        Some(&json!("/usr/bin/podman")),
        "a partial update must not blank sibling fields"
    );
    assert_eq!(
        settings.pointer("/api/connection/uri"),
        Some(&json!("/run/podman.sock"))
    );
}

#[test]
fn updating_an_unknown_id_changes_nothing() {
    let mut document = fixture();
    let before = document.to_json();
    document.update_connection("host.nope.podman.native", &json!({ "name": "x" }), "5.2.20");
    assert_eq!(document.to_json(), before);
}

#[test]
fn removing_a_connection_filters_by_id_and_keeps_the_rest_of_the_document() {
    let mut document = fixture();
    let before = ai_block(&document);

    document.create_connection(&new_connection(), "5.2.20");
    document.remove_connection("host.aaa.podman.native", "5.2.20");

    let ids: Vec<&str> = document
        .connections_value()
        .iter()
        .filter_map(|it| it.get("id").and_then(Value::as_str))
        .collect();
    assert_eq!(ids, ["host.bbb.docker.native"]);
    assert_eq!(ai_block(&document), before);
}

#[test]
fn the_document_round_trips_byte_identically_when_nothing_is_written() {
    // 2-space indent, no trailing newline — JSON.stringify(config, null, 2), which is what the app
    // writes. Anything else re-writes the user's whole file on the first edit.
    assert_eq!(fixture().to_json(), FIXTURE);
}

#[test]
fn legacy_connections_are_detected_from_the_first_entry() {
    let legacy = SettingsDocument::parse(
        r#"{ "connections": [{ "id": "a", "runtime": "podman", "engine": "podman.native" }] }"#,
    )
    .expect("legacy fixture parses");
    assert!(legacy.needs_legacy_migration());
    assert!(!fixture().needs_legacy_migration());
}

#[test]
fn the_legacy_migration_shifts_runtime_into_engine_and_engine_into_host() {
    // Old configs stored `runtime` as the engine and `engine` as the host.
    let mut legacy = SettingsDocument::parse(
        r#"{
  "ai": { "enabled": true },
  "connections": [
    { "id": "a", "name": "A", "runtime": "podman", "engine": "podman.native", "scopes": [] },
    { "id": "b", "name": "B", "runtime": "docker", "engine": "docker.native" }
  ]
}"#,
    )
    .expect("legacy fixture parses");

    assert!(legacy.migrate_legacy_connections("5.2.20"));

    assert_eq!(
        legacy.connections_value()[0],
        json!({ "id": "a", "name": "A", "engine": "podman", "scopes": [], "host": "podman.native" })
    );
    assert_eq!(
        legacy.connections_value()[1],
        json!({ "id": "b", "name": "B", "engine": "docker", "host": "docker.native" })
    );
    assert_eq!(
        legacy.as_value().get("ai"),
        Some(&json!({ "enabled": true })),
        "migration must not cost the user their unmodelled keys either"
    );

    // Compared as JSON above, which is order-insensitive — and the settings corpus caught exactly
    // the re-ordering that hides in that comparison (`Map::remove` is a SWAP-remove under
    // `preserve_order`). `host` is a new key, so it lands at the end; nothing else moves.
    let keys: Vec<&str> = legacy.connections_value()[0]
        .as_object()
        .expect("connection is an object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["id", "name", "engine", "scopes", "host"]);
}

#[test]
fn a_legacy_entry_with_no_engine_loses_its_host_rather_than_gaining_an_empty_one() {
    // The oracle assigns `undefined` where the source field is absent and `JSON.stringify` then
    // drops the key. A `host: null` left behind instead would fail to parse as a Connection.
    let mut legacy = SettingsDocument::parse(
        r#"{ "connections": [{ "id": "a", "host": "stale", "runtime": "podman" }] }"#,
    )
    .expect("legacy fixture parses");

    assert!(legacy.migrate_legacy_connections("5.2.20"));

    assert_eq!(
        legacy.connections_value()[0],
        json!({ "id": "a", "engine": "podman" }),
        "no engine to shift, so host is REMOVED — not set to null and not left stale"
    );
}

#[test]
fn migrating_an_already_migrated_document_is_a_no_op() {
    let mut document = fixture();
    let before = document.to_json();
    assert!(!document.migrate_legacy_connections("5.2.20"));
    assert_eq!(document.to_json(), before);
}

/// A document whose first connection carries `runtime: <value>` — the pre-migration marker.
fn with_legacy_marker(marker: Value) -> SettingsDocument {
    let document = json!({
      "connections": [
        { "id": "host.default.podman.native", "engine": "podman.native", "runtime": marker },
        { "id": "host.other.docker.native", "engine": "docker.native" }
      ]
    });
    SettingsDocument::parse(&serde_json::to_string_pretty(&document).expect("it serializes"))
        .expect("the fixture parses")
}

#[test]
fn only_a_truthy_runtime_marks_a_document_as_pre_migration() {
    // `if (it.runtime)` in the oracle, so JavaScript truthiness decides. An empty string is NOT a
    // marker, and migrating on one would shift an already-migrated document a second time.
    for truthy in [
        json!("podman"),
        json!(true),
        json!(1),
        json!(-1),
        json!(0.5),
        json!({}),
        json!([]),
        json!("0"),
    ] {
        assert!(
            with_legacy_marker(truthy.clone()).needs_legacy_migration(),
            "{truthy} is truthy in JavaScript, so it marks the legacy layout"
        );
    }
    for falsy in [json!(null), json!(false), json!(""), json!(0), json!(0.0)] {
        assert!(
            !with_legacy_marker(falsy.clone()).needs_legacy_migration(),
            "{falsy} is falsy, so it is not a marker"
        );
    }
}

#[test]
fn a_document_with_no_connections_needs_no_migration() {
    let empty = SettingsDocument::parse("{}").expect("an empty document parses");

    assert!(!empty.needs_legacy_migration());
    let mut empty = empty;
    assert!(
        !empty.migrate_legacy_connections("1.0.0"),
        "nothing to migrate means nothing is written — and no version stamp either"
    );
    assert_eq!(empty.to_json(), "{}");
}

#[test]
fn an_entry_that_is_not_an_object_survives_migration_untouched() {
    // The connections array is raw JSON the core does not own; a null or a string in it is somebody
    // else's data and must come back as it went in.
    let document = json!({
      "connections": [
        { "id": "host.default.podman.native", "engine": "podman.native", "runtime": "podman" },
        null,
        "not a connection"
      ]
    });
    let mut document =
        SettingsDocument::parse(&serde_json::to_string_pretty(&document).expect("it serializes"))
            .expect("the fixture parses");

    assert!(document.migrate_legacy_connections("1.2.3"));

    let connections = document.connections_value();
    assert_eq!(connections[1], Value::Null);
    assert_eq!(connections[2], json!("not a connection"));
    assert_eq!(
        connections[0].get("host").and_then(Value::as_str),
        Some("podman.native"),
        "the entry that IS a connection is still migrated"
    );
    assert!(connections[0].get("runtime").is_none());
}
