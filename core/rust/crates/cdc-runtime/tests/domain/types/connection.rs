//! A connection and its settings, as they are persisted.

use cdc_runtime::domain::types::connection::{
    Connection, EngineConnectorSettings, EngineExtension, SettingsMode, SortMode, SshHostType,
};
use serde_json::json;

fn minimal_connection() -> serde_json::Value {
    json!({
        "id": "host.default.podman.native",
        "name": "System Podman",
        "label": "Native",
        "engine": "podman",
        "host": "podman.native",
        "settings": {
            "api": { "baseURL": "http://d", "connection": { "uri": "", "relay": "" } },
            "program": { "name": "podman", "path": "" },
            "rootfull": false,
            "mode": "mode.automatic"
        }
    })
}

#[test]
fn connection_round_trips_without_inventing_nulls() {
    let input = minimal_connection();
    let parsed: Connection = serde_json::from_value(input.clone()).expect("should deserialize");
    let output = serde_json::to_value(&parsed).expect("should serialize");

    assert_eq!(output, input, "round trip must be lossless and add nothing");

    // Stated separately from the equality above so a failure names the actual problem.
    let object = output.as_object().expect("object");
    for absent in ["description", "disabled", "readonly", "logLevel"] {
        assert!(
            !object.contains_key(absent),
            "absent optional `{absent}` came back as an explicit null — every settings write would churn the file"
        );
    }
}

#[test]
fn the_settings_mode_wire_value_matches_the_shipping_app() {
    // Persisted in user-settings.json and read by the desktop app.
    assert_eq!(
        serde_json::to_value(SettingsMode::ModeAutomatic).unwrap(),
        json!("mode.automatic")
    );
}

#[test]
fn unknown_keys_do_not_break_deserialization() {
    // deny_unknown_fields is deliberately absent. A newer app version adding a field must
    // not make the core refuse to read the connection.
    let mut input = minimal_connection();
    input
        .as_object_mut()
        .unwrap()
        .insert("somethingNewerAppsAdded".into(), json!({ "a": 1 }));
    let parsed: Result<Connection, _> = serde_json::from_value(input);
    assert!(
        parsed.is_ok(),
        "unknown keys must be tolerated, not rejected"
    );
}

#[test]
fn settings_round_trip_preserves_controller_absence() {
    // `controller` is present exactly when the host is scoped. On a native
    // host it must stay absent rather than serialising as null.
    let input = minimal_connection()["settings"].clone();
    let parsed: EngineConnectorSettings = serde_json::from_value(input.clone()).unwrap();
    assert!(parsed.controller.is_none());
    assert_eq!(serde_json::to_value(&parsed).unwrap(), input);
}

#[test]
fn the_connection_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(EngineExtension::VOCABULARY);
    super::agrees_on_the_wire(SettingsMode::VOCABULARY);
    super::agrees_on_the_wire(SortMode::VOCABULARY);
    super::agrees_on_the_wire(SshHostType::VOCABULARY);
}
