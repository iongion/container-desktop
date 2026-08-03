//! `adapters/pods.ts` — libpod's alone. Gate every call on `capabilities.resources.pods`.

use serde_json::{Value, json};

use super::shared::{AdapterError, ApiCall, EngineApi, component};
use crate::domain::normalizers::normalize_pod;
use crate::domain::types::pod::{Pod, PodProcessReport};

/// `CreatePodOptions`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CreatePod {
    pub name: String,
    pub start: bool,
}

/// The id is carried for the reason
/// [`CreatedContainer`](super::containers::CreatedContainer)'s is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CreatedPod {
    pub id: String,
    pub started: bool,
}

pub async fn list(api: &EngineApi) -> Result<Vec<Pod>, AdapterError> {
    let mut pods: Vec<Pod> = api
        .read(&ApiCall::get("/pods/json?all=true").on_surface())
        .await?;
    for pod in &mut pods {
        normalize_pod(pod);
    }
    Ok(pods)
}

pub async fn get(api: &EngineApi, id: &str) -> Result<Pod, AdapterError> {
    let call = ApiCall::get(format!("/pods/{}/json", component(id))).on_surface();
    let mut pod: Pod = api.read(&call).await?;
    normalize_pod(&mut pod);
    Ok(pod)
}

/// An empty report for a `null` body, which is the original's own guard.
pub async fn processes(api: &EngineApi, id: &str) -> Result<PodProcessReport, AdapterError> {
    let call = ApiCall::get(format!("/pods/{}/top", component(id))).on_surface();
    let path = format!("/pods/{id}/top");
    let raw: Value = api.read(&call).await?;
    if raw.is_null() {
        return Ok(PodProcessReport::default());
    }
    serde_json::from_value(raw).map_err(|source| AdapterError::Malformed { path, source })
}

pub async fn create(api: &EngineApi, opts: &CreatePod) -> Result<CreatedPod, AdapterError> {
    let mut path = "/pods/create".to_string();
    if !opts.name.is_empty() {
        path.push_str(&format!("?name={}", component(&opts.name)));
    }
    let call = ApiCall::post(path)
        .sending(json!({ "name": opts.name }))
        .on_surface();
    let created: Value = api.read(&call).await?;
    let id = created
        .get("Id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut result = CreatedPod { id, started: false };
    if opts.start {
        start(api, &result.id).await?;
        result.started = true;
    }
    Ok(result)
}

pub async fn remove(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    let call = ApiCall::delete(format!("/pods/{}?force=true&v=true", component(id))).on_surface();
    api.send(&call).await?;
    Ok(())
}

pub async fn stop(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "stop").await
}

pub async fn start(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "start").await
}

pub async fn restart(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "restart").await
}

pub async fn pause(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "pause").await
}

pub async fn unpause(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "unpause").await
}

pub async fn kill(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "kill").await
}

/// A pod's lifecycle POSTs carry a `null` body in the original and take the host's default timeout —
/// unlike a container's stop, which is given the lifecycle budget.
async fn lifecycle(api: &EngineApi, id: &str, verb: &str) -> Result<(), AdapterError> {
    let call = ApiCall::post(format!("/pods/{}/{verb}", component(id)))
        .sending(Value::Null)
        .on_surface();
    api.send(&call).await?;
    Ok(())
}
