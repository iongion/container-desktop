//! `user-settings.json` held as a document, mutated only where the core owns it.
//!
//! The file is shared with the shipping desktop app and carries `ai`, `wizard`, `registries`,
//! `logging`, `font`, `theme`, `window` and whatever a newer app version adds. So the parse target
//! is `serde_json::Value`, never a struct: typed access is a **view** (`connections`), and every
//! mutation goes back into the same document at the same pointer. Deserializing the whole file into
//! a struct and serializing it back would delete the user's AI configuration on the first
//! connection edit — the most destructive thing this codebase could do.
//!
//! The connection array is likewise kept as raw JSON while it is being mutated. Entries carry keys
//! the connection schema does not model (`scopes` is in the author's own settings file today), and
//! the array is rewritten wholesale on every write, so rebuilding it from typed values would drop
//! them silently.

use serde_json::{Map, Value};

use crate::domain::settings::merge::{deep_merge, deep_merge_objects};
use crate::domain::types::connection::Connection;

/// The document key holding the connection array. The core owns this key, `connector`, `reconnect`,
/// `proxy` and `version`; everything else in the file is carried through untouched.
const CONNECTIONS: &str = "connections";
const VERSION: &str = "version";

/// The pre-migration layout stored the ENGINE in `runtime` and the HOST in `engine`.
const LEGACY_RUNTIME: &str = "runtime";
const ENGINE: &str = "engine";
const HOST: &str = "host";

/// The fields `createConnection` persists, in the order the oracle's object literal writes them.
const CREATE_FIELDS: &[&str] = &["id", "name", "label", "host", "engine", "settings"];

#[derive(Debug, thiserror::Error)]
pub enum DocumentError {
    #[error("user-settings.json is not valid JSON: {source}")]
    Malformed {
        #[source]
        source: serde_json::Error,
    },
    #[error("user-settings.json does not hold a JSON object")]
    NotAnObject,
    #[error("connections in user-settings.json do not match the connection schema: {source}")]
    Connections {
        #[source]
        source: serde_json::Error,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct SettingsDocument {
    root: Map<String, Value>,
}

impl SettingsDocument {
    /// Parse the file's contents.
    ///
    /// A missing file is the caller's `"{}"` — that is what `read()` in `config.ts` substitutes.
    /// Unparseable contents are an ERROR here, where the app logs and continues with `{}`: the app
    /// only reads, while this type also writes, and writing over a corrupt file would take the
    /// user's whole configuration with it.
    pub fn parse(contents: &str) -> Result<Self, DocumentError> {
        let value: Value =
            serde_json::from_str(contents).map_err(|source| DocumentError::Malformed { source })?;
        match value {
            Value::Object(root) => Ok(Self { root }),
            _ => Err(DocumentError::NotAnObject),
        }
    }

    pub fn as_value(&self) -> &Map<String, Value> {
        &self.root
    }

    /// `JSON.stringify(config, null, 2)` — two spaces, no trailing newline. Matching the app's
    /// exact formatting is what keeps a core write from re-writing every line of the user's file.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(&self.root).expect("a JSON document re-serializes")
    }

    /// The connection array as raw JSON — the mutation surface.
    pub fn connections_value(&self) -> &[Value] {
        self.root
            .get(CONNECTIONS)
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    /// The connection array as generated domain types — the read-only VIEW.
    pub fn connections(&self) -> Result<Vec<Connection>, DocumentError> {
        self.connections_value()
            .iter()
            .map(|value| {
                serde_json::from_value(value.clone())
                    .map_err(|source| DocumentError::Connections { source })
            })
            .collect()
    }

    /// `UserConfiguration.setKey` — deep-merge one owned key plus the version stamp, then
    /// deep-merge the result over the document, which is what `update()` does with its own read.
    /// Both merges are kept because the version stamp lands on every write, not just on some.
    pub fn set_key(&mut self, key: &str, value: Value, app_version: &str) {
        let patch = Map::from_iter([(key.to_string(), value)]);
        let stamp = Map::from_iter([(VERSION.to_string(), Value::String(app_version.to_string()))]);

        let updated = deep_merge_objects(&deep_merge_objects(&self.root, &patch), &stamp);
        self.root = deep_merge_objects(&self.root, &updated);
    }

    /// `Application.createConnection` — append, persisting only the six fields the oracle picks.
    ///
    /// `description` is among the fields it does NOT pick, so a created connection loses it. That
    /// looks like a bug and is preserved deliberately: the corpus records what the app does, and
    /// changing it is a TypeScript-first change.
    pub fn create_connection(&mut self, connection: &Value, app_version: &str) {
        let mut created = Map::new();
        for field in CREATE_FIELDS {
            if let Some(value) = connection.get(*field) {
                created.insert((*field).to_string(), value.clone());
            }
        }
        let mut connections = self.connections_value().to_vec();
        connections.push(Value::Object(created));
        self.set_key(CONNECTIONS, Value::Array(connections), app_version);
    }

    /// `Application.updateConnection` — find by id and deep-merge the partial. Deep-merge, not
    /// replace: a partial update must not blank sibling fields.
    pub fn update_connection(&mut self, id: &str, partial: &Value, app_version: &str) {
        let mut connections = self.connections_value().to_vec();
        let Some(found) = connections.iter_mut().find(|it| has_id(it, id)) else {
            return;
        };
        *found = deep_merge(found, partial);
        self.set_key(CONNECTIONS, Value::Array(connections), app_version);
    }

    /// `Application.removeConnection` — filter by id.
    pub fn remove_connection(&mut self, id: &str, app_version: &str) {
        let connections: Vec<Value> = self
            .connections_value()
            .iter()
            .filter(|it| !has_id(it, id))
            .cloned()
            .collect();
        self.set_key(CONNECTIONS, Value::Array(connections), app_version);
    }

    /// The oracle tests only the FIRST entry, and migrates all of them if it is set.
    pub fn needs_legacy_migration(&self) -> bool {
        self.connections_value()
            .first()
            .and_then(|it| it.get(LEGACY_RUNTIME))
            .is_some_and(is_truthy)
    }

    /// Shift the pre-migration layout into the current one: `host = engine`, `engine = runtime`,
    /// then drop `runtime`. Returns whether anything was written.
    ///
    /// This runs on first read and PERSISTS, so callers must route it through the locked write path
    /// in `cdc-runtime` rather than writing the document themselves.
    pub fn migrate_legacy_connections(&mut self, app_version: &str) -> bool {
        if !self.needs_legacy_migration() {
            return false;
        }
        let connections: Vec<Value> = self.connections_value().iter().map(migrate_entry).collect();
        self.set_key(CONNECTIONS, Value::Array(connections), app_version);
        true
    }
}

fn has_id(connection: &Value, id: &str) -> bool {
    connection.get("id").and_then(Value::as_str) == Some(id)
}

/// JavaScript truthiness, as `if (it.runtime)` applies it: an empty string is not a legacy marker.
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::String(text) => !text.is_empty(),
        Value::Number(number) => number.as_f64().is_some_and(|it| it != 0.0),
        _ => true,
    }
}

/// One entry, shifted. The oracle assigns `undefined` where a source field is absent, and
/// `JSON.stringify` then drops the key — so an absent source field removes the target key here.
fn migrate_entry(connection: &Value) -> Value {
    let Some(entry) = connection.as_object() else {
        return connection.clone();
    };
    let mut migrated = entry.clone();
    let host = entry.get(ENGINE).cloned();
    let engine = entry.get(LEGACY_RUNTIME).cloned();
    assign_or_remove(&mut migrated, ENGINE, engine);
    assign_or_remove(&mut migrated, HOST, host);
    // `shift_remove`, never `remove`: with `preserve_order` the latter is a SWAP-remove, which
    // moves the last key into the hole and silently re-orders the entry. `delete` in the oracle
    // leaves everything else where it was. The corpus caught this.
    migrated.shift_remove(LEGACY_RUNTIME);
    Value::Object(migrated)
}

fn assign_or_remove(entry: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    match value {
        Some(value) => {
            entry.insert(key.to_string(), value);
        }
        None => {
            entry.shift_remove(key);
        }
    }
}
