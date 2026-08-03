//! `normalizers/{shared,docker,podman}.ts` — an engine's raw answer, made canonical.
//!
//! **Three files become one, and the branch is on the API SURFACE rather than on the engine.** Only
//! `normalizeNetwork` genuinely differs between the two, and the original's per-engine modules exist
//! to carry that one override: `podmanNormalizers` and `dockerNormalizers` share every other member
//! by import. Two Rust traits differing in one method would be that indirection rebuilt for nothing —
//! and it would be keyed wrong, because the original selects the set on `host.apiSurface`, so Apple
//! (a Docker surface with its own engine) takes Docker's.
//!
//! `State` as object-vs-string is list-vs-inspect, not podman-vs-Docker. Do not build a second split
//! around it.
//!
//! **`normalizeVolume` and `normalizeSecret` are not here, and their absence is the port.** Both are
//! the identity in the original — they exist only to fill the `EngineNormalizers` interface, which
//! this module does not have. A volume and a secret are the same shape on both surfaces; the Docker
//! list ENVELOPE (`{ Volumes: [...] }`) is a list concern and belongs to whoever reads the list.

use serde_json::Value;

use super::compose::labels::{COMPOSE_PROJECT_LABELS, LABEL_CONTAINER_NUMBER, LABEL_SERVICE};
use super::types::container::{Container, ContainerHealth};
use super::types::engine::ApiSurface;
use super::types::image::ContainerImage;
use super::types::network::{Network, NetworkSubnet, NetworkSubnetLeaseRange};
use super::types::null_default;
use super::types::pod::{Pod, PodProcessReport};
use super::types::registry::{RegistrySearchOptions, RegistrySearchResult};

/// The separators a container name is split on when nothing better names its group.
pub const CONTAINER_GROUP_SEPARATORS: &[char] = &['-', '_'];

/// The group an infra container is filed under.
const POD_INFRASTRUCTURE_GROUP: &str = "Pod infrastructure";
const INFRA_SUFFIX: &str = "-infra";

/// A raw container — a list's `State` string or an inspect's `State` object — made canonical.
pub fn normalize_container(container: &mut Container) {
    if let Some(image_name) = container.image_name.clone()
        && !image_name.is_empty()
    {
        container.image = image_name;
    }
    container.computed.decoded_state = container.state.word().to_string();
    // Prefer an inspect's own health verdict; else read the list `Status` line. `??` falls through on
    // an ABSENT block only, which is why the block is an `Option`.
    let from_inspect = container.state.health_status();
    let status = from_inspect.unwrap_or_else(|| container.status.clone());
    container.computed.health = parse_health_from_status(&status);

    let name = container_name(container);
    if name.is_empty() {
        return;
    }
    container.computed.name = Some(name.clone());
    if let Some((group, name_in_group)) = compose_group(container) {
        // The project wins over the name heuristic; the real name is the fallback so a row is never
        // blank.
        container.computed.group = Some(group);
        container.computed.name_in_group = Some(if name_in_group.is_empty() {
            name
        } else {
            name_in_group
        });
    } else if name.ends_with(INFRA_SUFFIX) {
        container.computed.group = Some(POD_INFRASTRUCTURE_GROUP.to_string());
        container.computed.name_in_group = Some(name.replacen(INFRA_SUFFIX, "", 1));
    } else {
        let (group, name_in_group) = split_group_name(&name);
        container.computed.group = Some(group);
        container.computed.name_in_group = Some(name_in_group);
    }
}

/// The healthcheck verdict of the list `Status` line, from EITHER engine's spelling.
///
/// podman answers the bare word and Docker a suffix — `Up 2 minutes (healthy)`,
/// `(health: starting)`. `unhealthy` is matched first because it contains `healthy`, and the word
/// boundaries are what keep `Restarting` and `Exited` from matching on their letters.
pub fn parse_health_from_status(status: &str) -> Option<ContainerHealth> {
    if status.is_empty() {
        return None;
    }
    let value = status.to_lowercase();
    if has_word(&value, "unhealthy") {
        return Some(ContainerHealth::Unhealthy);
    }
    if says_starting(&value) {
        return Some(ContainerHealth::Starting);
    }
    if has_word(&value, "healthy") {
        return Some(ContainerHealth::Healthy);
    }
    None
}

/// A raw image made canonical: name, tag, registry and full name out of whichever list answered.
pub fn normalize_image(image: &mut ContainerImage) {
    let source = image.names.as_ref().or(image.names_history.as_ref());
    let first = source
        .and_then(|names| names.first())
        .cloned()
        .unwrap_or_default();
    // `[info, tag] = first.split(":")` — the first two pieces, so a registry PORT lands in `tag`.
    // Reproduced rather than repaired
    let mut pieces = first.splitn(3, ':');
    let info = pieces.next().unwrap_or_default();
    let mut tag = pieces.next().unwrap_or_default().to_string();
    let mut segments = info.split('/');
    let registry = segments.next().unwrap_or_default().to_string();
    let mut name = segments.collect::<Vec<_>>().join("/");
    if tag.is_empty()
        && let Some(repo_tags) = &image.repo_tags
    {
        let from_tag = repo_tags.first().cloned().unwrap_or_default();
        (name, tag) = split_repo_tag(&from_tag);
    }
    image.full_name = if tag.is_empty() {
        name.clone()
    } else {
        format!("{name}:{tag}")
    };
    image.name = name;
    image.tag = tag;
    image.registry = if registry.is_empty() {
        "docker.io".to_string()
    } else {
        registry
    };
    image.history = Vec::new();
}

/// A raw pod made canonical. The processes report is CLEARED — it is filled by a second call.
pub fn normalize_pod(pod: &mut Pod) {
    pod.processes = PodProcessReport::default();
}

/// A search result, with the searched registry filled in where the engine named none.
pub fn normalize_registry_search_result(
    result: &mut RegistrySearchResult,
    options: &RegistrySearchOptions,
) {
    if result.index.is_empty() {
        result.index = options.registry.name.clone();
    }
}

/// A raw network made canonical.
///
/// libpod already answers the canonical shape, so its arm is the identity. Docker answers PascalCase
/// and carries its subnets in `IPAM.Config[]`; `IPRange` is a sub-allocation range rather than a
/// lease window, so `lease_range` stays empty rather than being filled with something else's numbers.
pub fn normalize_network(surface: ApiSurface, raw: Value) -> Result<Network, serde_json::Error> {
    match surface {
        ApiSurface::Libpod => serde_json::from_value(raw),
        ApiSurface::Docker => Ok(Network::from(serde_json::from_value::<DockerNetwork>(raw)?)),
    }
}

/// Docker's network shape. A concept the original leaves as `any` and reads field by field; naming it
/// is what makes the mapping below total and the failure legible.
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct DockerNetwork {
    #[serde(rename = "Created")]
    created: String,
    #[serde(rename = "Driver")]
    driver: String,
    #[serde(rename = "EnableIPv6")]
    enable_ipv6: bool,
    #[serde(rename = "IPAM")]
    ipam: Value,
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Internal")]
    internal: bool,
    #[serde(rename = "Labels", deserialize_with = "null_default")]
    labels: std::collections::BTreeMap<String, String>,
    #[serde(rename = "Name")]
    name: String,
}

impl From<DockerNetwork> for Network {
    fn from(value: DockerNetwork) -> Self {
        let subnets = value
            .ipam
            .get("Config")
            .and_then(Value::as_array)
            .map(|config| config.iter().filter_map(docker_subnet).collect())
            .unwrap_or_default();
        Self {
            created: value.created,
            dns_enabled: false,
            driver: value.driver,
            id: value.id,
            internal: value.internal,
            ipam_options: value.ipam,
            ipv6_enabled: value.enable_ipv6,
            labels: value.labels,
            name: value.name,
            network_interface: "n/a".to_string(),
            options: std::collections::BTreeMap::new(),
            subnets,
        }
    }
}

/// One `IPAM.Config[]` entry. Entries without a `Subnet` are dropped, as the original drops them.
fn docker_subnet(entry: &Value) -> Option<NetworkSubnet> {
    let subnet = entry.get("Subnet").and_then(Value::as_str)?;
    Some(NetworkSubnet {
        gateway: entry
            .get("Gateway")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        lease_range: NetworkSubnetLeaseRange::default(),
        subnet: subnet.to_string(),
    })
}

/// `${container.Names?.[0] || container.Name}`, with the leading slashes Docker prefixes stripped.
fn container_name(container: &Container) -> String {
    let name = container
        .names
        .first()
        .filter(|name| !name.is_empty())
        .or(container.name.as_ref().filter(|name| !name.is_empty()));
    name.map(|name| name.trim_start_matches('/').to_string())
        .unwrap_or_default()
}

/// The compose project a container belongs to, and its per-replica name inside it.
///
/// Works for BOTH engines: `docker compose` writes `com.docker.compose.*` and podman-compose writes
/// `io.podman.compose.project` alongside the docker service and container-number labels.
fn compose_group(container: &Container) -> Option<(String, String)> {
    let project = COMPOSE_PROJECT_LABELS
        .iter()
        .filter_map(|key| container.labels.get(*key))
        .find(|value| !value.is_empty())?;
    let service = container
        .labels
        .get(LABEL_SERVICE)
        .cloned()
        .unwrap_or_default();
    let number = container
        .labels
        .get(LABEL_CONTAINER_NUMBER)
        .cloned()
        .unwrap_or_default();
    // Per-replica unique, so a scaled service does not render duplicate row names.
    let name_in_group = match (service.is_empty(), number.is_empty()) {
        (true, _) => String::new(),
        (false, true) => service,
        (false, false) => format!("{service}-{number}"),
    };
    Some((project.clone(), name_in_group))
}

/// The name-prefix heuristic: the FIRST separator that is not the first character.
fn split_group_name(name: &str) -> (String, String) {
    let at = CONTAINER_GROUP_SEPARATORS
        .iter()
        .filter_map(|separator| name.find(*separator))
        .filter(|index| *index > 0)
        .min();
    match at {
        None => (name.to_string(), String::new()),
        Some(at) => (name[..at].to_string(), name[at + 1..].to_string()),
    }
}

/// `RepoTags[0]` split into a name and a tag.
///
/// **The colonless case drops the name's last character**, because the original slices on an
/// `indexOf` of `-1`. Reproduced rather than repaired: every engine writes `repo:tag`, so it is
/// unreachable in practice, and repairing it would change what the app renders for a case nobody has
/// seen. Named in
fn split_repo_tag(from_tag: &str) -> (String, String) {
    match from_tag.find(':') {
        Some(at) => (from_tag[..at].to_string(), from_tag[at + 1..].to_string()),
        None => {
            let mut name = from_tag.to_string();
            name.pop();
            (name, from_tag.to_string())
        }
    }
}

/// `\bword\b` — the JavaScript word boundary, whose word characters are ASCII alphanumerics and `_`.
fn has_word(haystack: &str, word: &str) -> bool {
    haystack.match_indices(word).any(|(at, _)| {
        let before = haystack[..at].chars().next_back();
        let after = haystack[at + word.len()..].chars().next();
        !before.is_some_and(is_word_char) && !after.is_some_and(is_word_char)
    })
}

fn is_word_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

/// `/health:\s*starting|^starting$|\(\s*starting\s*\)/` — Docker's two spellings and podman's word.
fn says_starting(value: &str) -> bool {
    if value == "starting" {
        return true;
    }
    if value
        .split("health:")
        .skip(1)
        .any(|rest| rest.trim_start().starts_with("starting"))
    {
        return true;
    }
    value.split('(').skip(1).any(|rest| {
        rest.trim_start()
            .strip_prefix("starting")
            .is_some_and(|tail| tail.trim_start().starts_with(')'))
    })
}
