//! `adapters/containers.ts`.
//!
//! Every call but `create` uses the connection's own root, so on Podman these are the Docker-compat
//! routes. `get` does NOT compose logs/stats/processes: the original implements one of its four flags
//! and it assigns DECODED text, which an earlier audit leaves with the consumer.

use std::time::Duration;

use serde_json::{Value, json};

use super::shared::{AdapterError, ApiCall, EngineApi, component};
use crate::capabilities::http::HttpStreamOpen;
use crate::domain::normalizers::normalize_container;
use crate::domain::types::container::{Container, ContainerStats};
use crate::domain::types::image::{ContainerImageMount, ContainerImagePortMapping};
use crate::domain::types::pod::PodProcessReport;

/// `opts?.tail ?? 200` for a followed log; `all` for a whole one.
const STREAM_TAIL: u64 = 200;
const WHOLE_TAIL: &str = "all";

const ANY_HOST: &str = "0.0.0.0";
const LOCALHOST: &str = "localhost";
const LOOPBACK: &str = "127.0.0.1";

/// The original's `setTimeout(resolve, 3000)` between the stop and the restart.
///
/// The only place this crate waits on the clock: a back-off is a schedule that is computed and
/// returned (`domain::machine`), where this is one operation's internal settle.
const RESTART_SETTLE: Duration = Duration::from_secs(3);

/// `ContainerLogsOptions`. No `follow` — that is what tells [`logs`] from [`logs_stream`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LogsOptions {
    pub since: Option<String>,
    /// `None` is `all` for [`logs`] and 200 for [`logs_stream`].
    pub tail: Option<u64>,
}

/// `CreateContainerOptions`. No `Amount` — `create` never reads it; the caller's loop does.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CreateContainer {
    pub image_id: String,
    pub name: Option<String>,
    pub start: bool,
    pub mounts: Vec<ContainerImageMount>,
    pub port_mappings: Vec<ContainerImagePortMapping>,
}

/// The id is carried where the original drops it; `created` is gone because a failed create is an
/// [`AdapterError`] here.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CreatedContainer {
    pub id: String,
    pub started: bool,
}

pub async fn list(api: &EngineApi) -> Result<Vec<Container>, AdapterError> {
    let mut containers: Vec<Container> =
        api.read(&ApiCall::get("/containers/json?all=true")).await?;
    for container in &mut containers {
        normalize_container(container);
    }
    Ok(containers)
}

pub async fn get(api: &EngineApi, id: &str) -> Result<Container, AdapterError> {
    let call = ApiCall::get(format!("/containers/{}/json", component(id)));
    let mut container: Container = api.read(&call).await?;
    normalize_container(&mut container);
    Ok(container)
}

/// The log as it is on the wire: multiplexed frames, undecoded — see [`EngineApi::drain`].
pub async fn logs(api: &EngineApi, id: &str, opts: &LogsOptions) -> Result<Vec<u8>, AdapterError> {
    let tail = opts
        .tail
        .map_or_else(|| WHOLE_TAIL.to_string(), |tail| tail.to_string());
    api.drain(&logs_call(id, &tail, opts, false)).await
}

pub async fn logs_stream(
    api: &EngineApi,
    id: &str,
    opts: &LogsOptions,
) -> Result<HttpStreamOpen, AdapterError> {
    let tail = opts.tail.unwrap_or(STREAM_TAIL).to_string();
    api.open(&logs_call(id, &tail, opts, true)).await
}

/// No timeout on either: a read deadline aborts an idle follow and the stream degrades into a poll.
fn logs_call(id: &str, tail: &str, opts: &LogsOptions, follow: bool) -> ApiCall {
    let mut path = format!("/containers/{}/logs?", component(id));
    if follow {
        path.push_str("follow=true&");
    }
    path.push_str(&format!("stdout=true&stderr=true&tail={}", component(tail)));
    if let Some(since) = &opts.since {
        path.push_str(&format!("&since={}", component(since)));
    }
    ApiCall::get(path).as_octet_stream()
}

pub async fn stats(api: &EngineApi, id: &str) -> Result<ContainerStats, AdapterError> {
    let call = ApiCall::get(format!("/containers/{}/stats?stream=false", component(id)));
    api.read(&call).await
}

pub async fn processes(api: &EngineApi, id: &str) -> Result<PodProcessReport, AdapterError> {
    let call = ApiCall::get(format!("/containers/{}/top?ps_args=-aux", component(id)));
    let mut report: PodProcessReport = api.read(&call).await?;
    rejoin_short_rows(&mut report);
    Ok(report)
}

/// podman [#23986](https://github.com/containers/podman/pull/23986): a row arriving as one joined
/// string. Detected on the first row, applied to all; the last title is the command, so what follows
/// it is joined back.
///
/// Unreachable against podman 5.7.0 — measured, eleven titles and eleven cells on both routes.
fn rejoin_short_rows(report: &mut PodProcessReport) {
    let columns = report.titles.len();
    let Some(first) = report.processes.first() else {
        return;
    };
    if columns == 0 || first.len() == columns {
        return;
    }
    let last = columns - 1;
    for row in &mut report.processes {
        let Some(joined) = row.first() else {
            continue;
        };
        let mut cells: Vec<String> = joined.split_whitespace().map(str::to_string).collect();
        // `min` rather than a comparison: a row with fewer cells than titles still ends with a command
        // column, and the two arms an `if` would need produce the SAME answer at the boundary — an
        // equivalent mutant no test could kill.
        let command = cells.split_off(last.min(cells.len())).join(" ");
        cells.push(command);
        *row = cells;
    }
}

pub async fn pause(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "pause", false).await
}

pub async fn unpause(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "unpause", false).await
}

pub async fn start(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "start", false).await
}

pub async fn stop(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    lifecycle(api, id, "stop", true).await
}

/// A failed stop is swallowed, as in the original: a container that was not running has nothing to
/// stop, and the restart is what was asked for.
pub async fn restart(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    let _ = stop(api, id).await;
    tokio::time::sleep(RESTART_SETTLE).await;
    lifecycle(api, id, "restart", true).await
}

pub async fn remove(api: &EngineApi, id: &str) -> Result<(), AdapterError> {
    let call = ApiCall::delete(format!("/containers/{}?force=true&v=true", component(id))).slow();
    api.send(&call).await?;
    Ok(())
}

async fn lifecycle(api: &EngineApi, id: &str, verb: &str, slow: bool) -> Result<(), AdapterError> {
    let call = ApiCall::post(format!("/containers/{}/{verb}", component(id)));
    api.send(&if slow { call.slow() } else { call }).await?;
    Ok(())
}

pub async fn create(
    api: &EngineApi,
    opts: &CreateContainer,
) -> Result<CreatedContainer, AdapterError> {
    let mut path = "/containers/create".to_string();
    if let Some(name) = &opts.name {
        path.push_str(&format!("?name={}", component(name)));
    }
    let creator = if api.uses_docker_api() {
        docker_creator(opts)
    } else {
        libpod_creator(opts)
    };
    let created: Value = api
        .read(&ApiCall::post(path).sending(creator).on_surface())
        .await?;
    let id = created
        .get("Id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut result = CreatedContainer { id, started: false };
    if opts.start {
        start(api, &result.id).await?;
        result.started = true;
    }
    Ok(result)
}

/// A mount is sent only when it says both ends, as the original filters.
fn usable_mounts(opts: &CreateContainer) -> Vec<&ContainerImageMount> {
    opts.mounts
        .iter()
        .filter(|mount| {
            mount
                .source
                .as_deref()
                .is_some_and(|source| !source.is_empty())
                && !mount.destination.is_empty()
        })
        .collect()
}

fn libpod_creator(opts: &CreateContainer) -> Value {
    let mounts: Vec<Value> = usable_mounts(opts)
        .into_iter()
        .map(|mount| {
            json!({
                "Source": mount.source,
                "Destination": mount.destination,
                "Type": mount.type_.as_str(),
            })
        })
        .collect();
    let mut creator = json!({ "image": opts.image_id, "mounts": mounts });
    if let Some(name) = &opts.name {
        creator["name"] = json!(name);
    }
    if !opts.port_mappings.is_empty() {
        let published: Vec<Value> = opts
            .port_mappings
            .iter()
            .map(|mapping| {
                json!({
                    "protocol": mapping.protocol.as_str(),
                    "container_port": mapping.container_port,
                    "host_ip": published_host(&mapping.host_ip),
                    "host_port": mapping.host_port,
                })
            })
            .collect();
        creator["portmappings"] = json!(published);
    }
    creator
}

fn published_host(host_ip: &str) -> &str {
    match host_ip {
        "" => ANY_HOST,
        LOCALHOST => LOOPBACK,
        given => given,
    }
}

/// `PortBindings` carries `host_ip` verbatim — the original does not rewrite it here.
fn docker_creator(opts: &CreateContainer) -> Value {
    let mounts: Vec<Value> = usable_mounts(opts)
        .into_iter()
        .map(|mount| {
            json!({
                "Type": mount.type_.as_str(),
                "Source": mount.source,
                "Target": mount.destination,
                "ReadOnly": false,
            })
        })
        .collect();
    let mut host_config = json!({ "Mounts": mounts });
    if !opts.port_mappings.is_empty() {
        let mut bindings = serde_json::Map::new();
        for mapping in &opts.port_mappings {
            let key = format!("{}/{}", mapping.container_port, mapping.protocol.as_str());
            bindings.insert(
                key,
                json!([{ "HostPort": mapping.host_port.to_string(), "HostIp": mapping.host_ip }]),
            );
        }
        host_config["PortBindings"] = Value::Object(bindings);
    }
    let mut creator = json!({ "Image": opts.image_id, "HostConfig": host_config });
    if let Some(name) = &opts.name {
        creator["Name"] = json!(name);
    }
    creator
}
