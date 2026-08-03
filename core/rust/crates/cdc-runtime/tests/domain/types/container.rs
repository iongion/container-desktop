//! A container, read from what the two engines really answer.
//!
//! The payloads below are trimmed captures of real podman 5.7.0 and real Docker 29.7.0 on this
//! machine, keys and JSON types intact. That is the point of them: every divergence this module
//! models — `Command` as an argv or a line, `Created` as a timestamp or an integer, `Labels` as
//! `null` — was found by asking the engines rather than by reading the original's declarations.

use cdc_runtime::domain::types::container::{
    Container, ContainerHealth, ContainerPort, ContainerStateField, ContainerStateList,
    ContainerStats,
};
use serde_json::json;

/// One row of real `GET /v4.0.0/libpod/containers/json?all=true`.
pub fn podman_list_row() -> serde_json::Value {
    json!({
        "AutoRemove": false,
        "Command": ["httpd-foreground"],
        "Created": "2026-06-15T22:23:59.74007384+02:00",
        "CreatedAt": "",
        "CIDFile": "",
        "Exited": true,
        "ExitedAt": 1781996346,
        "ExitCode": 0,
        "ExposedPorts": {"80": ["tcp"]},
        "Id": "da341a95dc532acb4d3050ab3eb45ac965da36769c470dabee2c9915688378df",
        "Image": "docker.io/library/httpd:latest",
        "ImageID": "1c65d54bce7e0014d559163590c647fc47bc5c7ca6b5d3408b92168cc901853f",
        "IsInfra": false,
        "Labels": null,
        "Mounts": [],
        "Names": ["cool_blackburn"],
        "Namespaces": {},
        "Networks": [],
        "Pid": 0,
        "Pod": "",
        "PodName": "",
        "Ports": [{"host_ip": "", "container_port": 80, "host_port": 8889, "range": 1, "protocol": "tcp"}],
        "Restarts": 0,
        "Size": null,
        "StartedAt": 1781996331,
        "State": "exited",
        "Status": ""
    })
}

/// One row of real `GET /containers/json?all=true` on the Docker surface.
pub fn docker_list_row() -> serde_json::Value {
    json!({
        "Id": "5e33422a513c3fcb866b6b793e44e3ca8795a143f23ef51e4f3470c46dc928c6",
        "Names": ["/focused_antonelli"],
        "Image": "docker.io/library/alpine:3",
        "ImageID": "sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b",
        "Command": "sleep infinity",
        "Created": 1784637224,
        "Ports": [],
        "Labels": {"t": "A"},
        "State": "exited",
        "Status": "Exited (137) 10 days ago",
        "HostConfig": {"NetworkMode": "bridge"},
        "Health": {"Status": "none", "FailingStreak": 0},
        "Mounts": []
    })
}

#[test]
fn a_real_podman_row_reads_whole() {
    let container: Container = serde_json::from_value(podman_list_row()).expect("podman row");

    assert_eq!(container.names, vec!["cool_blackburn"]);
    // `Labels: null` is what podman really sends for a container with none. A bare map refuses it.
    assert!(container.labels.is_empty());
    // libpod answers an ARGV where Docker answers a line, so the field carries what arrived.
    assert_eq!(container.command, json!(["httpd-foreground"]));
    assert_eq!(
        container.created,
        json!("2026-06-15T22:23:59.74007384+02:00")
    );
    assert_eq!(
        container.state,
        ContainerStateField::Summary("exited".into())
    );
    assert_eq!(
        container.ports,
        vec![ContainerPort {
            container_port: 80,
            host_ip: String::new(),
            host_port: 8889,
            protocol: "tcp".into(),
            range: 1,
        }]
    );
}

#[test]
fn a_real_docker_row_reads_whole_and_disagrees_about_two_types() {
    let container: Container = serde_json::from_value(docker_list_row()).expect("docker row");

    assert_eq!(container.command, json!("sleep infinity"));
    assert_eq!(container.created, json!(1_784_637_224));
    assert_eq!(container.labels.get("t").map(String::as_str), Some("A"));
    assert_eq!(container.status, "Exited (137) 10 days ago");
}

#[test]
fn a_docker_port_row_arrives_through_the_aliases() {
    // Docker spells the same five fields in PascalCase. One field each, not nine.
    let port: ContainerPort = serde_json::from_value(json!({
        "IP": "0.0.0.0", "PrivatePort": 80, "PublicPort": 8080, "Type": "tcp"
    }))
    .expect("docker port");

    assert_eq!(
        port,
        ContainerPort {
            container_port: 80,
            host_ip: "0.0.0.0".into(),
            host_port: 8080,
            protocol: "tcp".into(),
            range: 0,
        }
    );
}

#[test]
fn an_inspect_reads_state_as_an_object_and_a_list_reads_it_as_a_word() {
    let inspect: Container = serde_json::from_value(json!({
        "Id": "x",
        "Name": "/focused_antonelli",
        "State": {"Status": "running", "Running": true, "OciVersion": "1.2.1"}
    }))
    .expect("inspect");

    let ContainerStateField::Detail(state) = &inspect.state else {
        panic!("an object State must not read as the word, or every inspect loses its detail");
    };
    assert!(state.running);
    assert_eq!(state.status, "running");
    // Neither engine sends the block for a container without a healthcheck, and the normalizer's
    // fallback depends on telling that from a present-but-empty one.
    assert!(state.health.is_none());
}

#[test]
fn a_stopped_dockers_null_ports_map_is_the_empty_map() {
    // Real Docker answers `"Ports": null` inside NetworkSettings for a container that is not running.
    let container: Container = serde_json::from_value(json!({
        "Id": "x",
        "NetworkSettings": {"Ports": null},
        "HostConfig": {"PortBindings": null}
    }))
    .expect("a stopped container");

    assert!(
        container
            .network_settings
            .expect("settings")
            .ports
            .is_empty()
    );
    assert!(
        container
            .host_config
            .expect("host config")
            .port_bindings
            .is_empty()
    );
}

#[test]
fn an_absent_optional_never_comes_back_as_null() {
    let written = serde_json::to_value(Container::default()).expect("a container serializes");
    let object = written.as_object().expect("an object");

    for key in ["ImageName", "Name", "Kube", "Logs", "Stats", "HostConfig"] {
        assert!(!object.contains_key(key), "{key} was written as null");
    }
}

#[test]
fn is_running_reads_the_decoded_state_first_then_the_two_shapes() {
    let mut container = Container::default();
    assert!(!container.is_running(), "an empty container is not running");

    // The decoded state wins outright.
    container.computed.decoded_state = "running".into();
    container.state = ContainerStateField::Summary("exited".into());
    assert!(container.is_running());
    container.computed.decoded_state = "exited".into();
    assert!(!container.is_running());

    // Without one, an inspect's flag counts on its own …
    container.computed.decoded_state = String::new();
    let mut state = cdc_runtime::domain::types::container::ContainerState {
        running: true,
        status: "stopping".into(),
        ..Default::default()
    };
    container.state = ContainerStateField::Detail(Box::new(state.clone()));
    assert!(container.is_running());
    state.running = false;
    state.status = ContainerStateList::Running.as_str().to_string();
    container.state = ContainerStateField::Detail(Box::new(state));
    assert!(container.is_running(), "the status alone counts too");

    // … and only the bare word is lowercased.
    container.state = ContainerStateField::Summary("RUNNING".into());
    assert!(container.is_running());
    container.state = ContainerStateField::Summary("restarting".into());
    assert!(!container.is_running());
}

#[test]
fn the_container_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(ContainerStateList::VOCABULARY);
    super::agrees_on_the_wire(ContainerHealth::VOCABULARY);
}

#[test]
fn a_real_stats_sample_reads_whole_and_is_keyed_by_interface() {
    // Real `GET /v1.41/containers/{id}/stats?stream=false` against podman 5.7.0, on cgroup v2 — which
    // is why `max_usage` is absent and why `precpu_stats` carries fewer fields than `cpu_stats`.
    let stats: ContainerStats = serde_json::from_value(json!({
        "read": "2026-08-03T00:44:30.481139536+02:00",
        "preread": "0001-01-01T00:00:00Z",
        "pids_stats": {"current": 82},
        "blkio_stats": {
            "io_service_bytes_recursive": [],
            "io_serviced_recursive": null,
            "io_queue_recursive": null,
            "io_service_time_recursive": null,
            "io_wait_time_recursive": null,
            "io_merged_recursive": null,
            "io_time_recursive": null,
            "sectors_recursive": null
        },
        "num_procs": 0,
        "storage_stats": {},
        "cpu_stats": {
            "cpu_usage": {"total_usage": 46_735_000, "usage_in_kernelmode": 21_809, "usage_in_usermode": 46_713_191},
            "system_cpu_usage": 343_070_845_997_000i64,
            "online_cpus": 32,
            "cpu": 0,
            "throttling_data": {"periods": 0, "throttled_periods": 0, "throttled_time": 0}
        },
        "precpu_stats": {
            "cpu_usage": {"total_usage": 0, "usage_in_kernelmode": 0, "usage_in_usermode": 0},
            "cpu": 0,
            "throttling_data": {"periods": 0, "throttled_periods": 0, "throttled_time": 0}
        },
        "memory_stats": {"usage": 14_340_096, "limit": 66_961_977_344i64},
        "name": "cdc-probe-stats",
        "id": "577fe9844f9439ab00a6c045a6282cbe63adecf941f290d3b4151e47198e2113",
        "networks": {"enp4s0": {"rx_bytes": 430, "rx_packets": 6, "rx_errors": 0, "rx_dropped": 0,
                                "tx_bytes": 1216, "tx_packets": 12, "tx_errors": 0, "tx_dropped": 0}}
    }))
    .expect("a real stats sample");

    // The two fields the app renders.
    assert_eq!(stats.cpu_stats.cpu, 0.0);
    assert_eq!(stats.memory_stats.usage, 14_340_096);
    // Absent on cgroup v2, and a zero here is honest rather than measured.
    assert_eq!(stats.memory_stats.max_usage, 0);
    // Keyed by INTERFACE. The original declares one key literally named `network`.
    assert_eq!(stats.networks.keys().collect::<Vec<_>>(), vec!["enp4s0"]);
    assert_eq!(stats.networks["enp4s0"].tx_bytes, 1216);
    // Lowercase `id`, and the previous sample simply has less in it.
    assert!(stats.id.starts_with("577fe98"));
    assert_eq!(stats.precpu_stats.online_cpus, 0);
    assert!(stats.blkio_stats.io_service_bytes_recursive.is_empty());
}

#[test]
fn an_exposed_port_bound_to_nothing_is_a_null_value_and_reads_as_no_bindings() {
    // Real `GET /containers/{id}/json` on podman 5.7.0, trimmed to the key that carries the rule.
    // `null_default` on the map is not enough: the map is present, and its VALUE is what is null.
    let container: Container = serde_json::from_value(json!({
        "Id": "abc",
        "NetworkSettings": {"Ports": {"80/tcp": null}},
        "HostConfig": {"Runtime": "crun", "PortBindings": {"80/tcp": null}}
    }))
    .expect("an inspect whose exposed port is bound to nothing");

    let settings = container.network_settings.expect("network settings");
    assert!(settings.ports["80/tcp"].is_empty());
    let host_config = container.host_config.expect("a host config");
    assert!(host_config.port_bindings["80/tcp"].is_empty());
}

#[test]
fn a_published_port_binding_reads_the_pascal_case_pair_both_engines_send() {
    // Real inspects, podman 5.7.0 and Docker 29.7.0, both against a container publishing a port.
    // Typed as a `ContainerPort` this did not refuse — it read zeroes, which is worse.
    let container: Container = serde_json::from_value(json!({
        "HostConfig": {"PortBindings": {"80/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18899"}]}},
        "NetworkSettings": {"Ports": {"80/tcp": [{"HostIp": "", "HostPort": "13309"}]}}
    }))
    .expect("an inspect with a published port");

    let binding = &container.host_config.expect("a host config").port_bindings["80/tcp"][0];
    assert_eq!(binding.host_ip, "127.0.0.1");
    assert_eq!(binding.host_port, "18899");
    let exposed = &container.network_settings.expect("network settings").ports["80/tcp"][0];
    assert_eq!(
        exposed.host_port, "13309",
        "Docker leaves HostIp empty and means every address"
    );
}

#[test]
fn a_bound_port_still_reads_its_binding() {
    let container: Container = serde_json::from_value(json!({
        "NetworkSettings": {"Ports": {"80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8889"}]}}
    }))
    .expect("an inspect with a published port");

    let settings = container.network_settings.expect("network settings");
    assert_eq!(settings.ports["80/tcp"][0].host_port, "8889");
}
