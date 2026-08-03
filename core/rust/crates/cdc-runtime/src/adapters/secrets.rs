//! `adapters/secrets.ts`. Same paths on both surfaces; only the root differs.
//!
//! A Docker that is not a swarm manager answers `503` here with its own sentence (measured, 29.7.0) —
//! which is why the call is gated on `capabilities.resources.secrets`, and why a refusal carries the
//! body rather than becoming an empty list.

use serde_json::json;

use super::shared::{AdapterError, ApiCall, EngineApi, component};
use crate::domain::types::secret::Secret;

/// `CreateSecretOptions`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CreateSecret {
    pub name: String,
    /// The secret itself, as the engine takes it.
    pub secret: String,
    pub driver: Option<String>,
}

pub async fn list(api: &EngineApi) -> Result<Vec<Secret>, AdapterError> {
    api.read(&ApiCall::get("/secrets/json").on_surface()).await
}

pub async fn get(api: &EngineApi, name_or_id: &str) -> Result<Secret, AdapterError> {
    let call = ApiCall::get(format!("/secrets/{}/json", component(name_or_id))).on_surface();
    api.read(&call).await
}

pub async fn create(api: &EngineApi, opts: &CreateSecret) -> Result<Secret, AdapterError> {
    let mut path = format!("/secrets/create?name={}", component(&opts.name));
    if let Some(driver) = &opts.driver {
        path.push_str(&format!("&driver={}", component(driver)));
    }
    let call = ApiCall::post(path)
        .sending(json!({ "Secret": opts.secret }))
        .on_surface();
    api.read(&call).await
}

pub async fn remove(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    let call = ApiCall::delete(format!("/secrets/{}?force=true", component(id))).on_surface();
    api.send(&call).await?;
    Ok(())
}
