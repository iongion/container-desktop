//! Swarm — the Docker surface's alone, and lean by design.

use cdc_runtime::domain::types::swarm::{
    NodeUpdateOptions, SwarmInfo, SwarmNodeAvailability, SwarmNodeRole, SwarmService,
};
use serde_json::json;

#[test]
fn a_node_not_in_a_swarm_answers_an_empty_id() {
    let info: SwarmInfo = serde_json::from_value(json!({})).expect("an empty cluster spec");
    assert!(
        info.id.is_empty(),
        "a non-empty ID is what means `in a swarm`"
    );
}

#[test]
fn a_replicated_service_and_a_global_one_are_told_apart_by_presence() {
    let replicated: SwarmService = serde_json::from_value(json!({
        "ID": "s1", "Spec": {"Name": "web", "Mode": {"Replicated": {"Replicas": 3}}}
    }))
    .expect("a replicated service");
    assert_eq!(
        replicated
            .spec
            .mode
            .replicated
            .expect("replicated")
            .replicas,
        3
    );
    assert!(replicated.spec.mode.global.is_none());

    let global: SwarmService = serde_json::from_value(json!({
        "ID": "s2", "Spec": {"Name": "agent", "Mode": {"Global": {}}}
    }))
    .expect("a global service");
    assert!(
        global.spec.mode.global.is_some(),
        "an empty object is the whole meaning"
    );
    assert!(global.spec.mode.replicated.is_none());
}

#[test]
fn a_node_update_writes_only_what_it_changes() {
    let written = serde_json::to_value(NodeUpdateOptions {
        availability: Some(SwarmNodeAvailability::Drain),
        role: None,
    })
    .expect("a node update serializes");

    assert_eq!(written, json!({"Availability": "drain"}));
}

#[test]
fn the_swarm_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(SwarmNodeAvailability::VOCABULARY);
    super::agrees_on_the_wire(SwarmNodeRole::VOCABULARY);
}
