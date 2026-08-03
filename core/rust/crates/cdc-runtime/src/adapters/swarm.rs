//! `adapters/swarm-rest.ts` + `adapters/swarm.ts` — Docker Swarm, as one module of free functions.
//!
//! The original's `SwarmAdapter` is a gated façade over the same REST owner, and the gate is the
//! CAPABILITY (`extensions.swarm`) rather than the surface: Apple Container is `docker`-surfaced with
//! `swarm: false`. That gate is the caller's, exactly as `resources.secrets` gates `secrets`, so the
//! façade collapses and what is left is the REST.
//!
//! **A read maps only `503` to nothing** — a node that is not a swarm manager — and everything else
//! propagates. The original also matched three message substrings, because the renderer→main proxy
//! rebuilt the error from a re-serialized subset and the status could arrive as a STRING. Here it is a
//! `u16` the whole way (`CommandProxyResponse::status`, and `TokioHttp` reads the real one), so those
//! fallbacks have no driver and are gone.
//!
//! Swarm is Docker-only, so every path is the connection's own root: `DOCKER_PATH_PREFIX` is `""`, which
//! makes `Root::Connection` the same string the original's `baseURL: DOCKER_BASE_URL` produces — and
//! immune to being asked on a libpod surface.

use base64::Engine as _;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use super::shared::{AdapterError, ApiCall, EngineApi, component};
use super::swarm_net::parse_host_addresses;
use crate::capabilities::command::HostCommand;
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::swarm::{
    HostAddress, NodeUpdateOptions, SwarmConfig, SwarmConfigCreateOptions, SwarmInfo,
    SwarmInitOptions, SwarmLeaveOptions, SwarmNode, SwarmSecret, SwarmSecretCreateOptions,
    SwarmService, SwarmStack, SwarmTask,
};
use crate::runtimes::composition::HostContext;

/// Docker's answer on a node that is not (part of) a swarm manager.
const NOT_A_SWARM_MANAGER: u16 = 503;

/// The label a stack is derived from. Stacks are not a REST object.
const STACK_NAMESPACE_LABEL: &str = "com.docker.stack.namespace";

/// What `docker swarm init` listens on when the caller names nothing.
const DEFAULT_LISTEN_ADDR: &str = "0.0.0.0:2377";

/// A list, or empty when this node is not a swarm manager.
async fn read_list<T: DeserializeOwned>(
    api: &EngineApi,
    path: String,
) -> Result<Vec<T>, AdapterError> {
    match api.read(&ApiCall::get(path)).await {
        Err(AdapterError::Refused { status, .. }) if status == NOT_A_SWARM_MANAGER => {
            Ok(Vec::new())
        }
        other => other,
    }
}

/// One object, or nothing when this node is not a swarm manager.
async fn read_one<T: DeserializeOwned>(
    api: &EngineApi,
    path: String,
) -> Result<Option<T>, AdapterError> {
    match api.read(&ApiCall::get(path)).await {
        Ok(one) => Ok(Some(one)),
        Err(AdapterError::Refused { status, .. }) if status == NOT_A_SWARM_MANAGER => Ok(None),
        Err(error) => Err(error),
    }
}

pub async fn inspect(api: &EngineApi) -> Result<Option<SwarmInfo>, AdapterError> {
    read_one(api, "/swarm".to_string()).await
}

/// The cluster's LIFECYCLE, so both of these take the lifecycle budget rather than the host's 3s.
///
/// **Measured against a real dind daemon**: a forced `leave` on a manager that still has a service tears
/// its Raft node down server-side and does not answer within 3000ms, so the default reported failure on a
/// call the engine went on to complete. `init` bootstraps the same Raft state. Same reason `stop` and
/// `restart` are slow — see [`ApiCall::slow`].
pub async fn init(api: &EngineApi, opts: &SwarmInitOptions) -> Result<(), AdapterError> {
    let body = json!({
        "ListenAddr": opts.listen_addr.clone().unwrap_or_else(|| DEFAULT_LISTEN_ADDR.to_string()),
        "AdvertiseAddr": opts.advertise_addr,
        "ForceNewCluster": opts.force_new_cluster.unwrap_or(false),
    });
    api.send(&ApiCall::post("/swarm/init").sending(body).slow())
        .await?;
    Ok(())
}

pub async fn leave(api: &EngineApi, opts: &SwarmLeaveOptions) -> Result<(), AdapterError> {
    let force = opts.force.unwrap_or(false);
    api.send(&ApiCall::post(format!("/swarm/leave?force={force}")).slow())
        .await?;
    Ok(())
}

pub async fn list_services(api: &EngineApi) -> Result<Vec<SwarmService>, AdapterError> {
    read_list(api, "/services".to_string()).await
}

pub async fn get_service(api: &EngineApi, id: &str) -> Result<Option<SwarmService>, AdapterError> {
    read_one(api, format!("/services/{}", component(id))).await
}

pub async fn create_service(api: &EngineApi, spec: &Value) -> Result<(), AdapterError> {
    api.send(&ApiCall::post("/services/create").sending(spec.clone()))
        .await?;
    Ok(())
}

pub async fn remove_service(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    api.send(&ApiCall::delete(format!("/services/{}", component(id))))
        .await?;
    Ok(())
}

/// `false` when no write was SENT, which is the one thing a refusal cannot say.
///
/// Read-modify-write at the object's current `Version.Index` — Docker's optimistic concurrency. The
/// object is read as a `Value` rather than as its type on purpose: the original guards on `Version`
/// being ABSENT, and a typed `SwarmVersion` under `#[serde(default)]` cannot tell that from an index of
/// zero. The `Spec` also has to be mutated generically, because `update` takes an arbitrary patch.
async fn update_spec(
    api: &EngineApi,
    path: &str,
    mutate: impl FnOnce(&mut Map<String, Value>),
) -> Result<bool, AdapterError> {
    let Some(object) = read_one::<Value>(api, path.to_string()).await? else {
        return Ok(false);
    };
    let Some(index) = object.pointer("/Version/Index").and_then(Value::as_i64) else {
        return Ok(false);
    };
    let mut spec = object
        .get("Spec")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    mutate(&mut spec);
    let call = ApiCall::post(format!("{path}/update?version={index}")).sending(Value::Object(spec));
    api.send(&call).await?;
    Ok(true)
}

pub async fn scale_service(api: &EngineApi, id: &str, replicas: i64) -> Result<bool, AdapterError> {
    let path = format!("/services/{}", component(id));
    update_spec(api, &path, |spec| {
        // `spec.Mode = spec.Mode ?? {}` — and a `Mode` that is not an object is replaced rather than
        // assigned into, or the replica count would be dropped and the scale would report success.
        let mut mode = spec
            .get("Mode")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        mode.insert("Replicated".to_string(), json!({ "Replicas": replicas }));
        spec.insert("Mode".to_string(), Value::Object(mode));
    })
    .await
}

pub async fn update_service(
    api: &EngineApi,
    id: &str,
    patch: &Map<String, Value>,
) -> Result<bool, AdapterError> {
    let path = format!("/services/{}", component(id));
    update_spec(api, &path, |spec| {
        for (key, value) in patch {
            spec.insert(key.clone(), value.clone());
        }
    })
    .await
}

pub async fn list_tasks(
    api: &EngineApi,
    service_id: Option<&str>,
) -> Result<Vec<SwarmTask>, AdapterError> {
    let path = match service_id {
        Some(id) => {
            let filters = json!({ "service": [id] }).to_string();
            format!("/tasks?filters={}", component(&filters))
        }
        None => "/tasks".to_string(),
    };
    read_list(api, path).await
}

/// One entry per `com.docker.stack.namespace` across the service list, in the order first seen.
pub async fn list_stacks(api: &EngineApi) -> Result<Vec<SwarmStack>, AdapterError> {
    let mut stacks: Vec<SwarmStack> = Vec::new();
    for service in list_services(api).await? {
        let Some(namespace) = service.spec.labels.get(STACK_NAMESPACE_LABEL) else {
            continue;
        };
        if namespace.is_empty() {
            continue;
        }
        match stacks.iter_mut().find(|stack| &stack.name == namespace) {
            Some(stack) => stack.services += 1,
            None => stacks.push(SwarmStack {
                name: namespace.clone(),
                orchestrator: "Swarm".to_string(),
                services: 1,
            }),
        }
    }
    Ok(stacks)
}

pub async fn list_nodes(api: &EngineApi) -> Result<Vec<SwarmNode>, AdapterError> {
    read_list(api, "/nodes".to_string()).await
}

pub async fn get_node(api: &EngineApi, id: &str) -> Result<Option<SwarmNode>, AdapterError> {
    read_one(api, format!("/nodes/{}", component(id))).await
}

/// The node's `Role` and `Availability`, each falling back to what the node already carries.
pub async fn update_node(
    api: &EngineApi,
    id: &str,
    opts: &NodeUpdateOptions,
) -> Result<bool, AdapterError> {
    let path = format!("/nodes/{}", component(id));
    update_spec(api, &path, |spec| {
        let role = opts
            .role
            .map(|role| json!(role))
            .or_else(|| spec.get("Role").cloned())
            .unwrap_or_else(|| json!("worker"));
        let availability = opts
            .availability
            .map(|availability| json!(availability))
            .or_else(|| spec.get("Availability").cloned())
            .unwrap_or_else(|| json!("active"));
        spec.insert("Role".to_string(), role);
        spec.insert("Availability".to_string(), availability);
    })
    .await
}

pub async fn remove_node(api: &EngineApi, id: &str, force: bool) -> Result<(), AdapterError> {
    api.send(&ApiCall::delete(format!(
        "/nodes/{}?force={force}",
        component(id)
    )))
    .await?;
    Ok(())
}

pub async fn list_secrets(api: &EngineApi) -> Result<Vec<SwarmSecret>, AdapterError> {
    read_list(api, "/secrets".to_string()).await
}

pub async fn get_secret(api: &EngineApi, id: &str) -> Result<Option<SwarmSecret>, AdapterError> {
    read_one(api, format!("/secrets/{}", component(id))).await
}

pub async fn create_secret(
    api: &EngineApi,
    opts: &SwarmSecretCreateOptions,
) -> Result<(), AdapterError> {
    let body = json!({
        "Name": opts.name,
        "Data": to_base64(&opts.data),
        "Labels": opts.labels,
    });
    api.send(&ApiCall::post("/secrets/create").sending(body))
        .await?;
    Ok(())
}

pub async fn remove_secret(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    api.send(&ApiCall::delete(format!("/secrets/{}", component(id))))
        .await?;
    Ok(())
}

pub async fn list_configs(api: &EngineApi) -> Result<Vec<SwarmConfig>, AdapterError> {
    read_list(api, "/configs".to_string()).await
}

pub async fn get_config(api: &EngineApi, id: &str) -> Result<Option<SwarmConfig>, AdapterError> {
    read_one(api, format!("/configs/{}", component(id))).await
}

pub async fn create_config(
    api: &EngineApi,
    opts: &SwarmConfigCreateOptions,
) -> Result<(), AdapterError> {
    let body = json!({
        "Name": opts.name,
        "Data": to_base64(&opts.data),
        "Labels": opts.labels,
    });
    api.send(&ApiCall::post("/configs/create").sending(body))
        .await?;
    Ok(())
}

pub async fn remove_config(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    api.send(&ApiCall::delete(format!("/configs/{}", component(id))))
        .await?;
    Ok(())
}

/// The engine takes `Data` base64, padded — `btoa` over the UTF-8 bytes.
fn to_base64(value: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(value.as_bytes())
}

/// What `ip` is called. `run_host_command` applies the `.exe` rule, so this is spelled once.
const IP_PROGRAM: &str = "ip";

/// The IPv4 interfaces of the connection's OWN host, as candidate `--advertise-addr` values.
///
/// **Not REST** — it runs `ip -4 -o addr show scope global` over the scoped-command seam, on the host the
/// connection lives on (native, SSH or WSL), which is why it takes a [`HostContext`] and not an
/// [`EngineApi`]. The init drawer offers these because a multi-NIC manager answers `400` with "could not
/// choose an IP address to advertise" and the user has to pick one.
///
/// **Best-effort by design**: an `ip` that is not there (Docker Desktop's VM) answers nothing rather than
/// failing, and the drawer degrades to free text. That is the original's `catch { return [] }`.
pub async fn list_advertise_candidates(
    host: &dyn HostContext,
    settings: &EngineConnectorSettings,
) -> Vec<HostAddress> {
    let args: Vec<String> = ["-4", "-o", "addr", "show", "scope", "global"]
        .iter()
        .map(|arg| (*arg).to_string())
        .collect();
    let outcome = if host.is_scoped() {
        match host.run_scope_command(IP_PROGRAM, &args, settings).await {
            Ok(outcome) => outcome,
            Err(_) => return Vec::new(),
        }
    } else {
        let command = HostCommand {
            launcher: IP_PROGRAM.to_string(),
            args,
            ..HostCommand::default()
        };
        host.run_host_command(&command).await
    };
    if !outcome.success() {
        return Vec::new();
    }
    parse_host_addresses(&outcome.stdout)
}
