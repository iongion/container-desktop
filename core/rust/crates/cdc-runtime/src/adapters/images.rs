//! `adapters/images.ts`. Every call uses the connection's own root — no per-call override at all.

use super::shared::{AdapterError, ApiCall, EngineApi, component};
use crate::domain::normalizers::normalize_image;
use crate::domain::types::image::{ContainerImage, ContainerImageHistory};

/// `PushImageOptions`. No `registryAuth` — the original declares it and never sends it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PushOptions {
    pub destination: Option<String>,
    /// Only `Some(false)` is ever sent, as in the original.
    pub tls_verify: Option<bool>,
}

pub async fn history(
    api: &EngineApi,
    id: &str,
) -> Result<Vec<ContainerImageHistory>, AdapterError> {
    api.read(&ApiCall::get(format!("/images/{id}/history")))
        .await
}

pub async fn list(api: &EngineApi) -> Result<Vec<ContainerImage>, AdapterError> {
    let mut images: Vec<ContainerImage> = api.read(&ApiCall::get("/images/json")).await?;
    for image in &mut images {
        normalize_image(image);
    }
    Ok(images)
}

/// `with_history` fills the app's own `History` field from `/images/{id}/history`, which the list
/// never carries: libpod's list has a `History` key of its own holding NAMES.
///
/// A failed history leaves it empty rather than failing the image, as in the original.
pub async fn get(
    api: &EngineApi,
    id: &str,
    with_history: bool,
) -> Result<ContainerImage, AdapterError> {
    let mut image: ContainerImage = api
        .read(&ApiCall::get(format!("/images/{id}/json")))
        .await?;
    normalize_image(&mut image);
    if with_history {
        image.history = history(api, id).await.unwrap_or_default();
    }
    Ok(image)
}

pub async fn remove(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    api.send(&ApiCall::delete(format!("/images/{id}"))).await?;
    Ok(())
}

pub async fn pull(api: &EngineApi, name: &str) -> Result<(), AdapterError> {
    let call = ApiCall::post(format!("/images/pull?reference={}", component(name)));
    api.send(&call).await?;
    Ok(())
}

/// `tslVerify` is the original's typo and it is what the engine is actually asked, so it is kept:
/// spelling it correctly would change which requests skip verification.
pub async fn push(api: &EngineApi, id: &str, opts: &PushOptions) -> Result<(), AdapterError> {
    let mut query = Vec::new();
    if let Some(destination) = &opts.destination {
        query.push(format!("destination={}", component(destination)));
    }
    if opts.tls_verify == Some(false) {
        query.push("tslVerify=false".to_string());
    }
    let mut path = format!("/images/{}/push", component(id));
    if !query.is_empty() {
        path.push('?');
        path.push_str(&query.join("&"));
    }
    api.send(&ApiCall::post(path)).await?;
    Ok(())
}
