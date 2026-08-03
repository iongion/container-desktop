//! Registries: the certificate authority's state, how a credential is held, and the TLS switch.

use cdc_runtime::domain::types::registry::{
    CertAuthorityStatus, RegistriesMap, Registry, RegistryAuthInfoKind, RegistrySearchResult,
    RegistryTlsState,
};
use serde_json::json;

#[test]
fn a_registry_offers_itself_per_engine_and_says_nothing_it_was_not_told() {
    let registry: Registry = serde_json::from_value(json!({
        "id": "docker.io", "name": "docker.io", "created": "2026-01-01T00:00:00Z",
        "weight": 0, "enabled": true, "isRemovable": false, "isSystem": true,
        "engine": ["podman", "docker"]
    }))
    .expect("a shipped registry");

    assert_eq!(registry.engine.len(), 2);
    // Trust and sign-in state are absent on a real connection until they are parsed, and must not
    // arrive as a confident default.
    assert_eq!(registry.tls, None);
    assert_eq!(registry.auth, None);
    assert_eq!(registry.mirror_of, None);
}

#[test]
fn an_absent_optional_never_comes_back_as_null() {
    let written = serde_json::to_value(RegistriesMap::default()).expect("a map serializes");
    assert_eq!(written, json!({"custom": [], "default": []}));

    let row = serde_json::to_value(Registry::default()).expect("a registry serializes");
    let object = row.as_object().expect("an object");
    for key in ["tls", "auth", "mirrorOf"] {
        assert!(!object.contains_key(key), "{key} was written as null");
    }
}

#[test]
fn a_search_result_carries_the_engines_two_string_flags_as_strings() {
    let result: RegistrySearchResult = serde_json::from_value(json!({
        "Index": "docker.io", "Name": "library/nginx", "Description": "web server",
        "Stars": 20000, "Official": "[OK]", "Automated": "", "Tag": ""
    }))
    .expect("a search row");

    assert_eq!(result.official, "[OK]");
    assert_eq!(result.stars, 20_000);
}

#[test]
fn the_registry_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(CertAuthorityStatus::VOCABULARY);
    super::agrees_on_the_wire(RegistryAuthInfoKind::VOCABULARY);
    super::agrees_on_the_wire(RegistryTlsState::VOCABULARY);
}
