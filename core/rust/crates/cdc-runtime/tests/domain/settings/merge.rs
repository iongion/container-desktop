//! `deep_merge` against the oracle: `deepMerge` in `src/packages/utils/src/index.ts`.
//!
//! That helper is `deepmerge`'s `merge.all` with two options — `arrayMerge: (_, source) => source`
//! and `isMergeableObject: isObject`. Every case below is one of those decisions. A subtly
//! different merge corrupts settings in ways that only surface much later, so
//! the semantics are pinned rather than described.

use cdc_runtime::domain::settings::merge::deep_merge;
use serde_json::json;

#[test]
fn nested_objects_merge_key_by_key() {
    let target = json!({ "api": { "baseURL": "http://d", "connection": { "uri": "/a" } } });
    let source = json!({ "api": { "connection": { "relay": "/b" } } });

    assert_eq!(
        deep_merge(&target, &source),
        json!({ "api": { "baseURL": "http://d", "connection": { "uri": "/a", "relay": "/b" } } }),
        "a partial update must not blank sibling fields"
    );
}

#[test]
fn arrays_are_replaced_not_concatenated() {
    // `arrayMerge: (_, source) => source`. This is what makes removeConnection work at all: the
    // shorter array must replace the longer one rather than merge into it.
    let target = json!({ "connections": [{ "id": "a" }, { "id": "b" }] });
    let source = json!({ "connections": [{ "id": "a" }] });

    assert_eq!(
        deep_merge(&target, &source),
        json!({ "connections": [{ "id": "a" }] })
    );
}

#[test]
fn scalars_and_null_from_the_source_win() {
    let target = json!({ "theme": "dark", "proxy": { "url": "http://p" } });
    let source = json!({ "theme": "light", "proxy": null });

    assert_eq!(
        deep_merge(&target, &source),
        json!({ "theme": "light", "proxy": null }),
        "null is not mergeable (isObject rejects it), so it replaces"
    );
}

#[test]
fn a_source_object_replaces_a_target_scalar() {
    let target = json!({ "logging": "debug" });
    let source = json!({ "logging": { "level": "debug" } });

    assert_eq!(
        deep_merge(&target, &source),
        json!({ "logging": { "level": "debug" } })
    );
}

#[test]
fn a_source_array_replaces_a_target_object() {
    // Mismatched container types short-circuit to the source in `deepmerge`; only object/object
    // recurses.
    let target = json!({ "registries": { "a": 1 } });
    let source = json!({ "registries": [1, 2] });

    assert_eq!(
        deep_merge(&target, &source),
        json!({ "registries": [1, 2] })
    );
}

#[test]
fn unknown_target_keys_are_carried_through() {
    // The whole point of: keys the core does not model must survive a merge untouched.
    let target = json!({ "ai": { "enabled": true, "providers": [{ "id": "openai" }] }, "window": { "w": 1 } });
    let source = json!({ "connections": [] });

    assert_eq!(
        deep_merge(&target, &source),
        json!({
            "ai": { "enabled": true, "providers": [{ "id": "openai" }] },
            "window": { "w": 1 },
            "connections": []
        })
    );
}

#[test]
fn key_order_is_target_first_then_new_source_keys_appended() {
    // `user-settings.json` is written by JSON.stringify, which emits insertion order. Re-ordering
    // the whole file on every write is not data loss, but it churns the user's config and makes a
    // real diff unreadable.
    let target = json!({ "theme": "dark", "connections": [] });
    let source = json!({ "connections": [1], "version": "5.2.20" });

    let merged = deep_merge(&target, &source);
    let keys: Vec<&str> = merged
        .as_object()
        .expect("merged is an object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["theme", "connections", "version"]);
}
