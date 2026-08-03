//! The merge the desktop app uses, ported exactly.
//!
//! The oracle is `deepMerge` in `src/packages/utils/src/index.ts`: the `deepmerge` package's
//! `merge.all` with `arrayMerge: (_, source) => source` and `isMergeableObject: isObject`.
//!
//! Deliberately NOT a crate. `json-patch::merge` is RFC 7386, where a `null` in the patch DELETES
//! the key; `json-value-merge` concatenates arrays. Both differ from the oracle in precisely the
//! dimension that matters here — array-replace is what makes `removeConnection` work, and
//! null-sets-null is what a settings partial means. Fifteen lines with the semantics pinned by
//! `tests/settings_merge.rs` beats a dependency whose behaviour nobody in this repository chose.

use serde_json::{Map, Value};

/// Merge `source` over `target`, recursing only where both sides are objects.
///
/// Everything else — arrays, scalars, `null`, and any object-versus-array mismatch — takes the
/// source value wholesale, which is what `deepmerge` does once `arrayMerge` returns the source.
pub fn deep_merge(target: &Value, source: &Value) -> Value {
    match (target, source) {
        (Value::Object(target), Value::Object(source)) => {
            Value::Object(deep_merge_objects(target, source))
        }
        _ => source.clone(),
    }
}

/// The same merge over two objects.
///
/// Separate because a document IS an object: routing the settings document through the `Value` form
/// would leave the caller unwrapping a variant that cannot occur, and an arm nothing can reach is an
/// arm nothing can check.
pub fn deep_merge_objects(
    target: &Map<String, Value>,
    source: &Map<String, Value>,
) -> Map<String, Value> {
    let mut merged = target.clone();
    for (key, value) in source {
        match target.get(key) {
            // The oracle guards this arm with `isMergeableObject(source[key])`; here it needs no
            // guard, because a non-object source short-circuits to itself one level down — the same
            // outcome as replacing, with one branch instead of two.
            Some(existing) => {
                merged.insert(key.clone(), deep_merge(existing, value));
            }
            None => {
                merged.insert(key.clone(), value.clone());
            }
        }
    }
    merged
}
