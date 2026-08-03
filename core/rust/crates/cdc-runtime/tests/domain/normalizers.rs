//! Making an engine's raw answer canonical — `normalizers/{shared,docker,podman}.ts`.
//!
//! The fixtures are the same real captures the type tests use, so a rule proved here is proved
//! against what podman 5.7.0 and Docker 29.7.0 actually send.

use cdc_runtime::domain::normalizers::{
    normalize_container, normalize_image, normalize_network, normalize_pod,
    normalize_registry_search_result, parse_health_from_status,
};
use cdc_runtime::domain::types::container::{Container, ContainerHealth};
use cdc_runtime::domain::types::engine::ApiSurface;
use cdc_runtime::domain::types::image::ContainerImage;
use cdc_runtime::domain::types::pod::{Pod, PodProcessReport};
use cdc_runtime::domain::types::registry::{Registry, RegistrySearchOptions, RegistrySearchResult};
use serde_json::{Value, json};

fn container(value: Value) -> Container {
    let mut container: Container = serde_json::from_value(value).expect("a container");
    normalize_container(&mut container);
    container
}

fn image(value: Value) -> ContainerImage {
    let mut image: ContainerImage = serde_json::from_value(value).expect("an image");
    normalize_image(&mut image);
    image
}

fn group_of(container: &Container) -> (&str, &str) {
    (
        container.computed.group.as_deref().unwrap_or_default(),
        container
            .computed
            .name_in_group
            .as_deref()
            .unwrap_or_default(),
    )
}

#[test]
fn a_real_podman_row_is_decoded_named_and_grouped() {
    let normalized = container(super::types::container::podman_list_row());

    assert_eq!(normalized.computed.decoded_state, "exited");
    assert_eq!(normalized.computed.name.as_deref(), Some("cool_blackburn"));
    // No compose labels and no infra suffix, so the name-prefix heuristic answers: the earliest
    // separator that is not the first character, which is the underscore.
    assert_eq!(group_of(&normalized), ("cool", "blackburn"));
    assert_eq!(normalized.computed.health, None);
}

#[test]
fn a_real_docker_row_loses_the_slash_docker_prefixes_its_names_with() {
    let normalized = container(super::types::container::docker_list_row());

    assert_eq!(
        normalized.computed.name.as_deref(),
        Some("focused_antonelli")
    );
    assert_eq!(normalized.computed.decoded_state, "exited");
}

#[test]
fn an_image_name_overrides_the_image_and_an_empty_one_does_not() {
    let named = container(json!({"Id": "x", "Image": "sha256:abc", "ImageName": "nginx:1"}));
    assert_eq!(named.image, "nginx:1");

    let unnamed = container(json!({"Id": "x", "Image": "sha256:abc", "ImageName": ""}));
    assert_eq!(unnamed.image, "sha256:abc");
}

#[test]
fn an_inspect_decodes_its_state_from_the_object() {
    let normalized = container(json!({
        "Id": "x", "Name": "/web", "State": {"Status": "running", "Running": true}
    }));

    assert_eq!(normalized.computed.decoded_state, "running");
}

#[test]
fn a_container_with_neither_name_computes_nothing_rather_than_the_word_undefined() {
    let normalized = container(json!({"Id": "x", "State": "created"}));

    assert_eq!(normalized.computed.name, None);
    assert_eq!(normalized.computed.group, None);
    // The state is still decoded — only the naming half is skipped.
    assert_eq!(normalized.computed.decoded_state, "created");
}

#[test]
fn the_name_falls_back_from_the_list_spelling_to_the_inspect_one() {
    let from_names = container(json!({"Id": "x", "Names": ["/api"], "Name": "/ignored"}));
    assert_eq!(from_names.computed.name.as_deref(), Some("api"));

    let from_name = container(json!({"Id": "x", "Names": [], "Name": "/api"}));
    assert_eq!(from_name.computed.name.as_deref(), Some("api"));
}

#[test]
fn a_compose_project_wins_over_the_name_heuristic_on_either_engines_labels() {
    let docker = container(json!({
        "Id": "x", "Names": ["/shop-web-1"],
        "Labels": {
            "com.docker.compose.project": "shop",
            "com.docker.compose.service": "web",
            "com.docker.compose.container-number": "1"
        }
    }));
    // Per-replica unique, so a scaled service does not render duplicate row names.
    assert_eq!(group_of(&docker), ("shop", "web-1"));

    let podman = container(json!({
        "Id": "x", "Names": ["/shop-web-1"],
        "Labels": {"io.podman.compose.project": "shop", "com.docker.compose.service": "web"}
    }));
    assert_eq!(group_of(&podman), ("shop", "web"));
}

#[test]
fn a_project_without_a_service_keeps_the_real_name_so_a_row_is_never_blank() {
    let normalized = container(json!({
        "Id": "x", "Names": ["/lonely"], "Labels": {"com.docker.compose.project": "shop"}
    }));

    assert_eq!(group_of(&normalized), ("shop", "lonely"));
}

#[test]
fn an_infra_container_is_filed_under_the_pod_infrastructure_group() {
    let normalized = container(json!({"Id": "x", "Names": ["/web-infra"]}));

    assert_eq!(group_of(&normalized), ("Pod infrastructure", "web"));
}

#[test]
fn the_name_heuristic_takes_the_earliest_separator_that_is_not_the_first_character() {
    // Both separators present: the earlier one wins, whichever it is.
    assert_eq!(
        group_of(&container(json!({"Id": "x", "Names": ["/a_b-c"]}))),
        ("a", "b-c")
    );
    assert_eq!(
        group_of(&container(json!({"Id": "x", "Names": ["/a-b_c"]}))),
        ("a", "b_c")
    );
    // A leading separator is not a group boundary — the whole name is the group.
    assert_eq!(
        group_of(&container(json!({"Id": "x", "Names": ["/-lead"]}))),
        ("-lead", "")
    );
    // No separator at all.
    assert_eq!(
        group_of(&container(json!({"Id": "x", "Names": ["/solo"]}))),
        ("solo", "")
    );
}

#[test]
fn health_comes_from_an_inspects_own_block_when_there_is_one() {
    let normalized = container(json!({
        "Id": "x", "Status": "Up 2 minutes (healthy)",
        "State": {"Status": "running", "Health": {"Status": "unhealthy"}}
    }));

    assert_eq!(normalized.computed.health, Some(ContainerHealth::Unhealthy));
}

#[test]
fn health_falls_back_to_the_list_status_only_when_the_block_is_absent() {
    let absent = container(json!({
        "Id": "x", "Status": "Up 2 minutes (healthy)", "State": {"Status": "running"}
    }));
    assert_eq!(absent.computed.health, Some(ContainerHealth::Healthy));

    // Present and empty is an ANSWER, not a gap: the fallback must not fire.
    let empty = container(json!({
        "Id": "x", "Status": "Up 2 minutes (healthy)",
        "State": {"Status": "running", "Health": {"Status": ""}}
    }));
    assert_eq!(empty.computed.health, None);
}

#[test]
fn the_status_parser_reads_both_engines_spellings() {
    // podman answers the bare word.
    assert_eq!(
        parse_health_from_status("healthy"),
        Some(ContainerHealth::Healthy)
    );
    assert_eq!(
        parse_health_from_status("unhealthy"),
        Some(ContainerHealth::Unhealthy)
    );
    assert_eq!(
        parse_health_from_status("starting"),
        Some(ContainerHealth::Starting)
    );
    // Docker answers a suffix.
    assert_eq!(
        parse_health_from_status("Up 2 minutes (healthy)"),
        Some(ContainerHealth::Healthy)
    );
    assert_eq!(
        parse_health_from_status("Up 2 minutes (unhealthy)"),
        Some(ContainerHealth::Unhealthy)
    );
    assert_eq!(
        parse_health_from_status("Up 3 seconds (health: starting)"),
        Some(ContainerHealth::Starting)
    );
    assert_eq!(
        parse_health_from_status("Up 3 seconds ( starting )"),
        Some(ContainerHealth::Starting)
    );
}

#[test]
fn the_status_parser_answers_nothing_where_there_is_no_healthcheck() {
    assert_eq!(parse_health_from_status(""), None);
    // The states that merely CONTAIN the letters. This is what the word boundaries are for.
    assert_eq!(
        parse_health_from_status("Restarting (1) 2 seconds ago"),
        None
    );
    assert_eq!(parse_health_from_status("Exited (137) 10 days ago"), None);
    assert_eq!(parse_health_from_status("Up 2 minutes"), None);
    // Adjacent word characters are not a match either.
    assert_eq!(parse_health_from_status("prehealthy"), None);
    assert_eq!(parse_health_from_status("healthyish"), None);
    assert_eq!(parse_health_from_status("healthy_pod"), None);
}

#[test]
fn unhealthy_is_read_before_healthy_because_it_contains_it() {
    assert_eq!(
        parse_health_from_status("Up 2 minutes (unhealthy)"),
        Some(ContainerHealth::Unhealthy),
        "reading `healthy` first would call a failing container well"
    );
}

#[test]
fn a_real_podman_image_takes_its_name_from_the_names_list() {
    let normalized = image(super::types::image::podman_list_row());

    assert_eq!(normalized.registry, "docker.io");
    assert_eq!(normalized.name, "library/httpd");
    assert_eq!(normalized.tag, "latest");
    assert_eq!(normalized.full_name, "library/httpd:latest");
    assert!(normalized.history.is_empty());
}

#[test]
fn a_real_docker_image_has_no_names_and_falls_through_to_its_repo_tags() {
    let normalized = image(super::types::image::docker_list_row());

    assert_eq!(normalized.name, "container-desktop-ssh-remote");
    assert_eq!(normalized.tag, "dev");
    assert_eq!(normalized.full_name, "container-desktop-ssh-remote:dev");
    // Nothing named a registry, so the default stands.
    assert_eq!(normalized.registry, "docker.io");
}

#[test]
fn an_untagged_name_falls_through_to_the_repo_tags_and_an_absent_list_does_not() {
    let with_tags = image(json!({
        "Id": "x", "Names": ["localhost/mine"], "RepoTags": ["localhost/mine:v2"]
    }));
    assert_eq!(
        (with_tags.name.as_str(), with_tags.tag.as_str()),
        ("localhost/mine", "v2")
    );

    // No RepoTags key at all: the name from `Names` stands and there is no tag.
    let without = image(json!({"Id": "x", "Names": ["localhost/mine"]}));
    assert_eq!((without.name.as_str(), without.tag.as_str()), ("mine", ""));
    assert_eq!(without.registry, "localhost");
    assert_eq!(without.full_name, "mine");
}

#[test]
fn an_empty_repo_tags_list_is_entered_and_blanks_the_name() {
    // `if (image.RepoTags)` is TRUE for an empty array in JavaScript, so the branch is taken and
    // overwrites what `Names` produced. Pinned because a `Vec` cannot tell empty from absent and
    // the port would take the other branch.
    let normalized = image(json!({"Id": "x", "Names": ["localhost/mine"], "RepoTags": []}));

    assert_eq!(
        (normalized.name.as_str(), normalized.tag.as_str()),
        ("", "")
    );
}

#[test]
fn a_registry_port_lands_in_the_tag_and_a_colonless_repo_tag_loses_a_character() {
    // Both are the original's, reproduced rather than repaired
    let ported = image(json!({"Id": "x", "Names": ["localhost:5000/mine:v1"]}));
    assert_eq!(ported.registry, "localhost");
    assert_eq!(ported.tag, "5000/mine");

    let colonless = image(json!({"Id": "x", "Names": [""], "RepoTags": ["nginx"]}));
    assert_eq!(
        (colonless.name.as_str(), colonless.tag.as_str()),
        ("ngin", "nginx")
    );
}

#[test]
fn a_pods_process_report_is_cleared_for_the_call_that_fills_it() {
    let mut pod: Pod = serde_json::from_value(json!({
        "Id": "p", "Processes": {"Titles": ["USER"], "Processes": [["root"]]}
    }))
    .expect("a pod");

    normalize_pod(&mut pod);

    assert_eq!(pod.processes, PodProcessReport::default());
}

#[test]
fn a_libpod_network_is_already_canonical() {
    let raw = json!({
        "name": "podman",
        "id": "2f259bab93aa",
        "driver": "bridge",
        "network_interface": "podman0",
        "created": "2026-08-03T00:29:59.09112036+02:00",
        "subnets": [{"subnet": "10.88.0.0/16", "gateway": "10.88.0.1"}],
        "ipv6_enabled": false,
        "internal": false,
        "dns_enabled": false,
        "ipam_options": {"driver": "host-local"}
    });

    let network = normalize_network(ApiSurface::Libpod, raw).expect("a libpod network");

    assert_eq!(network.name, "podman");
    assert_eq!(network.network_interface, "podman0");
    assert_eq!(network.subnets.len(), 1);
    assert_eq!(network.subnets[0].subnet, "10.88.0.0/16");
    // libpod answers no window, and none is invented.
    assert_eq!(network.subnets[0].lease_range.start_ip, "");
}

#[test]
fn a_docker_network_is_mapped_onto_the_canonical_shape() {
    let raw = json!({
        "Name": "kalshi_default",
        "Id": "1b1e162a57ba",
        "Created": "2026-06-06T23:38:19.587327932+02:00",
        "Driver": "bridge",
        "EnableIPv6": false,
        "IPAM": {
            "Driver": "default",
            "Options": null,
            "Config": [{"Subnet": "172.19.0.0/16", "Gateway": "172.19.0.1"}, {"Gateway": "10.0.0.1"}]
        },
        "Internal": false,
        "Options": {},
        "Labels": {"com.docker.compose.project": "kalshi"}
    });

    let network = normalize_network(ApiSurface::Docker, raw).expect("a docker network");

    assert_eq!(network.name, "kalshi_default");
    assert_eq!(network.id, "1b1e162a57ba");
    assert_eq!(network.driver, "bridge");
    // Docker has no interface to report and no DNS flag; both say so rather than guessing.
    assert_eq!(network.network_interface, "n/a");
    assert!(!network.dns_enabled);
    assert_eq!(
        network
            .labels
            .get("com.docker.compose.project")
            .map(String::as_str),
        Some("kalshi")
    );
    // The whole IPAM object travels, which is what the original puts here through a cast.
    assert_eq!(network.ipam_options.get("Driver"), Some(&json!("default")));
    // An entry with no Subnet is dropped rather than carried as an empty one.
    assert_eq!(network.subnets.len(), 1);
    assert_eq!(network.subnets[0].gateway, "172.19.0.1");
    // IPRange is a sub-allocation range, not a lease window, so nothing fills this.
    assert_eq!(network.subnets[0].lease_range.end_ip, "");
}

#[test]
fn a_docker_network_with_null_labels_reads_and_a_wrongly_typed_one_refuses() {
    let nulled = normalize_network(ApiSurface::Docker, json!({"Name": "n", "Labels": null}))
        .expect("a docker network with no labels");
    assert!(nulled.labels.is_empty());

    assert!(
        normalize_network(ApiSurface::Docker, json!({"Name": 7})).is_err(),
        "a wrongly typed answer must say so rather than come back blank"
    );
}

#[test]
fn a_search_result_is_seeded_with_the_registry_that_was_searched() {
    let options = RegistrySearchOptions {
        registry: Registry {
            name: "quay.io".to_string(),
            ..Default::default()
        },
        term: "nginx".to_string(),
        ..Default::default()
    };

    let mut unnamed = RegistrySearchResult::default();
    normalize_registry_search_result(&mut unnamed, &options);
    assert_eq!(unnamed.index, "quay.io");

    let mut named = RegistrySearchResult {
        index: "docker.io".to_string(),
        ..Default::default()
    };
    normalize_registry_search_result(&mut named, &options);
    assert_eq!(
        named.index, "docker.io",
        "an engine's own answer is not overwritten"
    );
}
