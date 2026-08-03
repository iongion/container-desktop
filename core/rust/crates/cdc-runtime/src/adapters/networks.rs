//! `adapters/networks.ts`.
//!
//! Docker lists at `/networks` in PascalCase, libpod at `/networks/json` already canonical;
//! [`normalize_network`] maps both. A single get is normalized like a list, which is why the Docker
//! create can re-fetch and need no second pass.

use serde_json::Value;
use serde_json::json;

use super::shared::{AdapterError, ApiCall, EngineApi, component};
use crate::domain::normalizers::normalize_network;
use crate::domain::types::network::Network;

/// `CreateNetworkOptions` — the original's `Partial<Network>`, narrowed to what it actually maps.
/// Subnets are its own open TODO on the Docker side.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CreateNetwork {
    pub name: String,
    pub driver: String,
    pub internal: bool,
    pub ipv6_enabled: bool,
}

pub async fn list(api: &EngineApi) -> Result<Vec<Network>, AdapterError> {
    let path = if api.uses_docker_api() {
        "/networks"
    } else {
        "/networks/json"
    };
    let raw: Vec<Value> = api.read(&ApiCall::get(path).on_surface()).await?;
    raw.into_iter().map(|it| decode(api, path, it)).collect()
}

pub async fn get(api: &EngineApi, name: &str) -> Result<Network, AdapterError> {
    let name = component(name);
    let path = if api.uses_docker_api() {
        format!("/networks/{name}")
    } else {
        format!("/networks/{name}/json")
    };
    let raw: Value = api.read(&ApiCall::get(&path).on_surface()).await?;
    decode(api, &path, raw)
}

/// Docker's create answers only an `Id`, so the network is read back; libpod answers the network.
pub async fn create(api: &EngineApi, opts: &CreateNetwork) -> Result<Network, AdapterError> {
    if api.uses_docker_api() {
        let creator = json!({
            "Name": opts.name,
            "Driver": opts.driver,
            "Internal": opts.internal,
            "EnableIPv6": opts.ipv6_enabled,
        });
        let created: Value = api
            .read(
                &ApiCall::post("/networks/create")
                    .sending(creator)
                    .on_surface(),
            )
            .await?;
        let id = created
            .get("Id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return get(api, id).await;
    }
    let creator = json!({
        "name": opts.name,
        "driver": opts.driver,
        "internal": opts.internal,
        "ipv6_enabled": opts.ipv6_enabled,
    });
    let raw: Value = api
        .read(
            &ApiCall::post("/networks/create")
                .sending(creator)
                .on_surface(),
        )
        .await?;
    decode(api, "/networks/create", raw)
}

pub async fn remove(api: &EngineApi, name: &str) -> Result<(), AdapterError> {
    let call = ApiCall::delete(format!("/networks/{}", component(name))).on_surface();
    api.send(&call).await?;
    Ok(())
}

fn decode(api: &EngineApi, path: &str, raw: Value) -> Result<Network, AdapterError> {
    normalize_network(api.surface(), raw).map_err(|source| AdapterError::Malformed {
        path: path.to_string(),
        source,
    })
}
