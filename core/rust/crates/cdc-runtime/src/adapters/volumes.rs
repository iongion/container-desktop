//! `adapters/volumes.ts`.
//!
//! libpod lists at `/volumes/json` and answers a bare array; Docker lists at `/volumes` and answers
//! `{ "Volumes": [...] }` (measured on both). Unwrapping the envelope is a LIST concern and belongs
//! here, not in a normalizer.
//!
//! `normalizeVolume` is not ported — it is the identity, and exists only to fill an interface.

use serde_json::{Value, json};

use super::shared::{AdapterError, ApiCall, EngineApi, component};
use crate::domain::types::volume::Volume;

/// `CreateVolumeOptions`. Both `Label` and `Labels` travel, as in the original.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CreateVolume {
    pub name: String,
    pub driver: String,
    pub label: Vec<(String, String)>,
    pub labels: Vec<(String, String)>,
    pub options: Vec<(String, String)>,
}

pub async fn list(api: &EngineApi) -> Result<Vec<Volume>, AdapterError> {
    if api.uses_docker_api() {
        let envelope: Value = api.read(&ApiCall::get("/volumes").on_surface()).await?;
        let volumes = envelope.get("Volumes").cloned().unwrap_or(Value::Null);
        if volumes.is_null() {
            return Ok(Vec::new());
        }
        return serde_json::from_value(volumes).map_err(|source| AdapterError::Malformed {
            path: "/volumes".to_string(),
            source,
        });
    }
    api.read(&ApiCall::get("/volumes/json").on_surface()).await
}

pub async fn get(api: &EngineApi, name_or_id: &str) -> Result<Volume, AdapterError> {
    let name = component(name_or_id);
    let path = if api.uses_docker_api() {
        format!("/volumes/{name}")
    } else {
        format!("/volumes/{name}/json")
    };
    api.read(&ApiCall::get(path).on_surface()).await
}

pub async fn create(api: &EngineApi, opts: &CreateVolume) -> Result<Volume, AdapterError> {
    let creator = json!({
        "Name": opts.name,
        "Driver": opts.driver,
        "Label": pairs(&opts.label),
        "Labels": pairs(&opts.labels),
        "Options": pairs(&opts.options),
    });
    let call = ApiCall::post("/volumes/create")
        .sending(creator)
        .on_surface();
    api.read(&call).await
}

pub async fn remove(api: &EngineApi, name_or_id: &str) -> Result<(), AdapterError> {
    let call =
        ApiCall::delete(format!("/volumes/{}?force=true", component(name_or_id))).on_surface();
    api.send(&call).await?;
    Ok(())
}

fn pairs(entries: &[(String, String)]) -> Value {
    Value::Object(
        entries
            .iter()
            .map(|(key, value)| (key.clone(), Value::String(value.clone())))
            .collect(),
    )
}
