//! `adapters/pods-rest.ts` — a pod's logs over REST, because libpod has no pod-logs endpoint.
//!
//! It fans out to each member container's `/containers/{id}/logs` — the endpoint the containers screen
//! already reads — demultiplexes each body and prefixes every line with its container, so the result
//! reads like `podman pod logs` with no local CLI. That is why it is the DEFAULT rather than a fallback:
//! an API/socket connection has no `program.path` to run.

use serde_json::Value;

use super::shared::{AdapterError, ApiCall, EngineApi, component};
use crate::capabilities::command::CommandExecutionResult;
use crate::domain::logs::decode_container_log_bytes;

/// What the original asks for when the caller names no tail.
const DEFAULT_TAIL: i64 = 100;

/// Aggregate a pod's member logs. The infra container is excluded — it carries none of the pod's output.
///
/// **A member that cannot be read is reported in place, not fatal**: one container the engine has already
/// pruned would otherwise cost the whole pod's logs.
pub async fn pod_logs(
    api: &EngineApi,
    pod_id: &str,
    tail: Option<i64>,
) -> Result<CommandExecutionResult, AdapterError> {
    let call = ApiCall::get(format!("/pods/{}/json", component(pod_id))).on_surface();
    let inspected: Value = api.read(&call).await?;
    let tail = tail.unwrap_or(DEFAULT_TAIL);

    let mut sections: Vec<String> = Vec::new();
    for id in member_ids(&inspected) {
        let name = name_of(&inspected, &id);
        sections.push(match member_log(api, &id, tail).await {
            Ok(text) if text.is_empty() => format!("{name} | <no logs>"),
            Ok(text) => text
                .split('\n')
                .map(|line| format!("{name} | {line}"))
                .collect::<Vec<_>>()
                .join("\n"),
            Err(_) => format!("{name} | <logs unavailable>"),
        });
    }

    Ok(CommandExecutionResult::ok(sections.join("\n")))
}

/// One member's log, demultiplexed, with trailing whitespace trimmed as the original trims it.
async fn member_log(api: &EngineApi, id: &str, tail: i64) -> Result<String, AdapterError> {
    let call = ApiCall::get(format!(
        "/containers/{}/logs?stdout=true&stderr=true&tail={tail}&timestamps=false",
        component(id)
    ))
    .on_surface()
    .as_octet_stream();
    let bytes = api.drain(&call).await?;
    Ok(decode_container_log_bytes(&bytes).trim_end().to_string())
}

/// The pod's members, minus its infra container.
fn member_ids(inspected: &Value) -> Vec<String> {
    let infra = inspected
        .get("InfraContainerID")
        .or_else(|| inspected.get("InfraID"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    inspected
        .get("Containers")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|member| member.get("Id").and_then(Value::as_str))
        .filter(|id| !id.is_empty() && *id != infra)
        .map(str::to_string)
        .collect()
}

/// `Name`, else the first of `Names`, else the id — with the leading slash Docker puts on a name gone.
fn name_of(inspected: &Value, id: &str) -> String {
    let member = inspected
        .get("Containers")
        .and_then(Value::as_array)
        .and_then(|members| {
            members
                .iter()
                .find(|member| member.get("Id").and_then(Value::as_str) == Some(id))
        });
    let named = member.and_then(|member| {
        member
            .get("Name")
            .and_then(Value::as_str)
            .or_else(|| {
                member
                    .get("Names")
                    .and_then(Value::as_array)
                    .and_then(|names| names.first())
                    .and_then(Value::as_str)
            })
            .filter(|name| !name.is_empty())
    });
    named.unwrap_or(id).trim_start_matches('/').to_string()
}
