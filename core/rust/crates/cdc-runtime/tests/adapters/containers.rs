//! The container adapter, against real captures from podman 5.7.0.

use cdc_runtime::adapters::base_urls::{LIBPOD_PATH_PREFIX, LIFECYCLE_TIMEOUT};
use cdc_runtime::adapters::containers::{self, CreateContainer, CreatedContainer, LogsOptions};
use cdc_runtime::domain::types::engine::ApiSurface;
use cdc_runtime::domain::types::image::{
    ContainerImageMount, ContainerImageMountDriver, ContainerImageMountType,
    ContainerImagePortMapping, ContainerImagePortProtocol,
};
use serde_json::{Value, json};

use super::fakes::FakeHttp;
use super::{asked, bound, only, routed, serving};

/// One row of real `GET http://d/containers/json?all=true` — the COMPAT route, which is the one the
/// list adapter uses. `Config` is `null`, the name is slashed, `Command` is a string and `Created` is
/// an integer: every one of those is Docker's shape coming back from podman.
const COMPAT_ROW: &str = r#"[{
  "Id": "da341a95dc532acb4d3050ab3eb45ac965da36769c470dabee2c9915688378df",
  "Names": ["/cool_blackburn"],
  "Image": "docker.io/library/httpd:latest",
  "ImageID": "sha256:1c65d54bce7e0014d559163590c647fc47bc5c7ca6b5d3408b92168cc901853f",
  "Command": "httpd-foreground",
  "Created": 1781555039,
  "Ports": [{"PrivatePort": 80, "PublicPort": 8889, "Type": "tcp"}],
  "Labels": {},
  "State": "exited",
  "Status": "Exited (0) 6 weeks ago",
  "Mounts": [],
  "Name": "",
  "Config": null,
  "NetworkingConfig": null,
  "Platform": null
}]"#;

/// Real `GET /containers/{id}/stats?stream=false`, trimmed to the keys that carry a rule.
const STATS: &str = r#"{
  "read": "2026-08-03T09:50:52.184169478+02:00",
  "id": "8a67126b70b5f81f5e2dc5e5db6a6686babbfc1d3fcadeedca07e82a79f0255f",
  "name": "cdc-probe-top",
  "networks": {"enp4s0": {"rx_bytes": 430, "tx_bytes": 1156}},
  "blkio_stats": {"io_service_bytes_recursive": [], "io_serviced_recursive": null},
  "memory_stats": {"usage": 1234}
}"#;

/// Real `GET /containers/{id}/top?ps_args=-aux` on 5.7.0 — eleven titles, eleven cells.
const TOP: &str = r#"{
  "Processes": [["root","1","1.4","0.0","6216","4740","?","SNs","09:50","0:00","httpd -DFOREGROUND"]],
  "Titles": ["USER","PID","%CPU","%MEM","VSZ","RSS","TTY","STAT","START","TIME","COMMAND"]
}"#;

const ID: &str = "da341a95dc53";

#[tokio::test]
async fn a_real_compat_row_reads_whole_and_the_name_loses_its_slash() {
    let (api, log) = serving(ApiSurface::Libpod, COMPAT_ROW);

    let containers = containers::list(&api).await.expect("the list");

    assert_eq!(
        only(&log).path,
        "/containers/json?all=true",
        "the connection's own root, so this is the compat route"
    );
    let container = &containers[0];
    assert_eq!(container.computed.name.as_deref(), Some("cool_blackburn"));
    assert_eq!(container.computed.decoded_state, "exited");
    assert_eq!(container.ports[0].container_port, 80);
    assert_eq!(container.ports[0].host_port, 8889);
    assert_eq!(container.command, json!("httpd-foreground"));
}

#[tokio::test]
async fn an_inspect_is_normalized_the_same_way_a_list_row_is() {
    const INSPECT: &str =
        r#"{"Id":"abc","Name":"/web","State":{"Running":true,"Status":"running"}}"#;
    let (api, log) = serving(ApiSurface::Libpod, INSPECT);

    let container = containers::get(&api, ID).await.expect("the container");

    assert_eq!(only(&log).path, format!("/containers/{ID}/json"));
    assert_eq!(container.computed.name.as_deref(), Some("web"));
    assert!(container.is_running());
}

#[tokio::test]
async fn a_whole_log_asks_for_every_line_and_keeps_every_byte() {
    const FRAME: &[u8] = &[0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xac];
    let (api, log) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|_| Ok(super::fakes::answered(200, "")))
            .delivering_bytes(&[FRAME, b"AH00558"]),
    );

    let bytes = containers::logs(&api, ID, &LogsOptions::default())
        .await
        .expect("the log");

    let request = only(&log);
    assert_eq!(
        request.path,
        format!("/containers/{ID}/logs?stdout=true&stderr=true&tail=all")
    );
    assert!(
        !request.path.contains("follow"),
        "a whole read never follows"
    );
    assert!(
        request
            .headers
            .contains(&("Accept".to_string(), "application/octet-stream".to_string()))
    );
    assert_eq!(&bytes[..8], FRAME, "the frame header survived the read");
}

#[tokio::test]
async fn a_log_carries_since_and_a_tail_when_it_is_given_them() {
    let (api, log) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|_| Ok(super::fakes::answered(200, ""))),
    );
    let opts = LogsOptions {
        since: Some("2026-08-03T09:00:00Z".to_string()),
        tail: Some(50),
    };

    containers::logs(&api, ID, &opts).await.expect("the log");

    assert_eq!(
        only(&log).path,
        format!(
            "/containers/{ID}/logs?stdout=true&stderr=true&tail=50&since=2026-08-03T09%3A00%3A00Z"
        ),
        "a timestamp's colons are encoded, as the original's params would"
    );
}

#[tokio::test]
async fn a_followed_log_follows_defaults_to_200_lines_and_is_never_given_a_deadline() {
    let (api, log) = bound(
        ApiSurface::Libpod,
        FakeHttp::scripted(|_| Ok(super::fakes::answered(200, ""))).delivering(&["a line"]),
    );

    let opened = containers::logs_stream(&api, ID, &LogsOptions::default())
        .await
        .expect("the stream");

    let request = only(&log);
    assert_eq!(
        request.path,
        format!("/containers/{ID}/logs?follow=true&stdout=true&stderr=true&tail=200")
    );
    assert_eq!(
        request.timeout, None,
        "a read deadline would abort an idle follow and turn the stream into a poll"
    );
    assert_eq!(opened.status, 200);
}

#[tokio::test]
async fn stats_asks_once_and_reads_the_lowercase_id_and_the_per_interface_counters() {
    let (api, log) = serving(ApiSurface::Libpod, STATS);

    let stats = containers::stats(&api, ID).await.expect("the sample");

    assert_eq!(
        only(&log).path,
        format!("/containers/{ID}/stats?stream=false"),
        "`stream=false` is what makes this one sample rather than a feed"
    );
    assert_eq!(
        stats.id,
        "8a67126b70b5f81f5e2dc5e5db6a6686babbfc1d3fcadeedca07e82a79f0255f"
    );
    assert_eq!(stats.networks["enp4s0"].rx_bytes, 430);
}

#[tokio::test]
async fn a_full_width_top_answer_is_left_exactly_as_it_arrived() {
    let (api, log) = serving(ApiSurface::Libpod, TOP);

    let report = containers::processes(&api, ID).await.expect("the report");

    assert_eq!(
        only(&log).path,
        format!("/containers/{ID}/top?ps_args=-aux")
    );
    assert_eq!(report.titles.len(), 11);
    assert_eq!(
        report.processes[0][10], "httpd -DFOREGROUND",
        "the command keeps its space because nothing was re-split"
    );
}

#[tokio::test]
async fn a_short_row_is_re_split_and_the_command_is_rejoined_as_the_last_column() {
    // podman#23986: the whole row arrives as one cell.
    const SHORT: &str = r#"{
      "Processes": [["root 1 1.4 0.0 6216 4740 ? SNs 09:50 0:00 httpd -DFOREGROUND"]],
      "Titles": ["USER","PID","%CPU","%MEM","VSZ","RSS","TTY","STAT","START","TIME","COMMAND"]
    }"#;
    let (api, _) = serving(ApiSurface::Libpod, SHORT);

    let report = containers::processes(&api, ID).await.expect("the report");

    assert_eq!(report.processes[0].len(), 11, "one cell per title");
    assert_eq!(report.processes[0][0], "root");
    assert_eq!(
        report.processes[0][10], "httpd -DFOREGROUND",
        "everything past the last title is one command again"
    );
}

#[tokio::test]
async fn a_row_shorter_than_its_titles_still_ends_with_a_command_column() {
    const TRUNCATED: &str = r#"{"Processes": [["root 1"]], "Titles": ["USER","PID","COMMAND"]}"#;
    let (api, _) = serving(ApiSurface::Libpod, TRUNCATED);

    let report = containers::processes(&api, ID).await.expect("the report");

    assert_eq!(report.processes[0], vec!["root", "1", ""]);
}

#[tokio::test]
async fn a_top_with_no_rows_at_all_is_left_alone() {
    let (api, _) = serving(
        ApiSurface::Libpod,
        r#"{"Processes":[],"Titles":["USER","PID"]}"#,
    );

    let report = containers::processes(&api, ID).await.expect("the report");

    assert!(
        report.processes.is_empty(),
        "there is no first row to measure"
    );
}

#[tokio::test]
async fn a_row_with_no_cells_is_skipped_rather_than_given_an_empty_command() {
    const RAGGED: &str = r#"{"Processes":[["root 1"],[]],"Titles":["USER","PID","COMMAND"]}"#;
    let (api, _) = serving(ApiSurface::Libpod, RAGGED);

    let report = containers::processes(&api, ID).await.expect("the report");

    assert_eq!(report.processes[0], vec!["root", "1", ""]);
    assert!(
        report.processes[1].is_empty(),
        "nothing to re-split, so nothing invented"
    );
}

#[tokio::test]
async fn a_published_host_that_is_a_real_address_is_passed_through_untouched() {
    let (api, log) = serving(ApiSurface::Libpod, r#"{"Id":"new-id"}"#);
    let opts = CreateContainer {
        image_id: "httpd".to_string(),
        port_mappings: vec![mapping("192.168.0.31", 8080)],
        ..CreateContainer::default()
    };

    containers::create(&api, &opts).await.expect("created");

    let body: Value =
        serde_json::from_str(only(&log).body.as_deref().expect("a body")).expect("json");
    assert_eq!(body["portmappings"][0]["host_ip"], "192.168.0.31");
}

#[tokio::test]
async fn a_named_docker_create_sends_the_name_in_both_places_too() {
    let (api, log) = serving(ApiSurface::Docker, r#"{"Id":"new-id"}"#);
    let opts = CreateContainer {
        image_id: "httpd".to_string(),
        name: Some("web".to_string()),
        ..CreateContainer::default()
    };

    containers::create(&api, &opts).await.expect("created");

    let request = only(&log);
    assert_eq!(request.path, "/containers/create?name=web");
    let body: Value = serde_json::from_str(request.body.as_deref().expect("a body")).expect("json");
    assert_eq!(body["Name"], "web");
}

#[tokio::test]
async fn only_the_slow_lifecycle_calls_are_given_the_lifecycle_budget() {
    let (api, log) = serving(ApiSurface::Libpod, "null");

    containers::start(&api, ID).await.expect("start");
    containers::pause(&api, ID).await.expect("pause");
    containers::unpause(&api, ID).await.expect("unpause");
    containers::stop(&api, ID).await.expect("stop");
    containers::remove(&api, ID).await.expect("remove");

    let requests = asked(&log);
    let paths: Vec<&str> = requests.iter().map(|it| it.path.as_str()).collect();
    assert_eq!(
        paths,
        vec![
            format!("/containers/{ID}/start"),
            format!("/containers/{ID}/pause"),
            format!("/containers/{ID}/unpause"),
            format!("/containers/{ID}/stop"),
            format!("/containers/{ID}?force=true&v=true"),
        ]
    );
    assert_eq!(
        requests.iter().map(|it| it.timeout).collect::<Vec<_>>(),
        vec![
            None,
            None,
            None,
            Some(LIFECYCLE_TIMEOUT),
            Some(LIFECYCLE_TIMEOUT)
        ]
    );
    assert_eq!(requests[4].method, "DELETE");
}

#[tokio::test(start_paused = true)]
async fn a_restart_stops_first_and_a_stop_that_failed_does_not_stop_it() {
    let (api, log) = routed(
        ApiSurface::Libpod,
        &[
            ("/containers/da341a95dc53/stop", 500, "already stopping"),
            ("/containers/da341a95dc53/restart", 204, "null"),
        ],
    );

    containers::restart(&api, ID).await.expect("the restart");

    let paths: Vec<String> = asked(&log).iter().map(|it| it.path.clone()).collect();
    assert_eq!(
        paths,
        vec![
            format!("/containers/{ID}/stop"),
            format!("/containers/{ID}/restart")
        ],
        "a container that was not running has nothing to stop"
    );
}

#[tokio::test]
async fn a_libpod_create_names_the_surface_root_and_sends_libpods_own_creator() {
    let (api, log) = serving(ApiSurface::Libpod, r#"{"Id":"new-id"}"#);
    let opts = CreateContainer {
        image_id: "docker.io/library/httpd:latest".to_string(),
        name: Some("web".to_string()),
        start: false,
        mounts: vec![mount(Some("/host"), "/data"), mount(None, "/nowhere")],
        port_mappings: vec![mapping("localhost", 8080), mapping("", 8081)],
    };

    let created = containers::create(&api, &opts).await.expect("created");

    let request = only(&log);
    assert_eq!(
        request.path,
        format!("{LIBPOD_PATH_PREFIX}/containers/create?name=web")
    );
    assert_eq!(
        created,
        CreatedContainer {
            id: "new-id".to_string(),
            started: false
        }
    );
    let body: Value = serde_json::from_str(request.body.as_deref().expect("a body")).expect("json");
    assert_eq!(body["image"], "docker.io/library/httpd:latest");
    assert_eq!(
        body["name"], "web",
        "the name travels in the body as well as the query"
    );
    assert_eq!(
        body["mounts"],
        json!([{"Source": "/host", "Destination": "/data", "Type": "bind"}]),
        "a mount missing one of its two ends is not sent"
    );
    assert_eq!(
        body["portmappings"][0]["host_ip"], "127.0.0.1",
        "libpod will not resolve the name `localhost`"
    );
    assert_eq!(body["portmappings"][1]["host_ip"], "0.0.0.0");
}

#[tokio::test]
async fn a_docker_create_sends_host_config_and_leaves_host_ip_alone() {
    let (api, log) = serving(ApiSurface::Docker, r#"{"Id":"new-id"}"#);
    let opts = CreateContainer {
        image_id: "httpd".to_string(),
        name: None,
        start: false,
        mounts: vec![mount(Some("/host"), "/data")],
        port_mappings: vec![mapping("localhost", 8080)],
    };

    containers::create(&api, &opts).await.expect("created");

    let request = only(&log);
    assert_eq!(
        request.path, "/containers/create",
        "no name, so no query — and Docker's root adds no prefix"
    );
    let body: Value = serde_json::from_str(request.body.as_deref().expect("a body")).expect("json");
    assert_eq!(body["Image"], "httpd");
    assert!(
        body.get("Name").is_none(),
        "an unnamed create sends no Name"
    );
    assert_eq!(
        body["HostConfig"]["Mounts"],
        json!([{"Type": "bind", "Source": "/host", "Target": "/data", "ReadOnly": false}])
    );
    assert_eq!(
        body["HostConfig"]["PortBindings"],
        json!({"8080/tcp": [{"HostPort": "8080", "HostIp": "localhost"}]}),
        "Docker resolves the host itself, and the original does not rewrite it here"
    );
}

#[tokio::test]
async fn a_create_that_was_asked_to_start_starts_what_it_made() {
    let (api, log) = routed(
        ApiSurface::Libpod,
        &[
            (
                "/v4.0.0/libpod/containers/create",
                201,
                r#"{"Id":"new-id"}"#,
            ),
            ("/containers/new-id/start", 204, "null"),
        ],
    );
    let opts = CreateContainer {
        image_id: "httpd".to_string(),
        start: true,
        ..CreateContainer::default()
    };

    let created = containers::create(&api, &opts).await.expect("created");

    assert!(created.started);
    assert_eq!(
        asked(&log)[1].path,
        "/containers/new-id/start",
        "started through the connection's root, like every other lifecycle call"
    );
}

#[tokio::test]
async fn a_create_that_was_not_asked_to_start_makes_one_request() {
    let (api, log) = serving(ApiSurface::Libpod, r#"{"Id":"new-id"}"#);

    let created = containers::create(&api, &CreateContainer::default())
        .await
        .expect("created");

    assert!(!created.started);
    assert_eq!(asked(&log).len(), 1);
}

#[tokio::test]
async fn a_create_with_no_ports_sends_no_port_key_at_all() {
    let (api, log) = serving(ApiSurface::Libpod, r#"{"Id":"new-id"}"#);

    containers::create(&api, &CreateContainer::default())
        .await
        .expect("created");

    let body: Value =
        serde_json::from_str(only(&log).body.as_deref().expect("a body")).expect("json");
    assert!(
        body.get("portmappings").is_none(),
        "the original passes `undefined`, which JSON.stringify omits"
    );
    assert_eq!(
        body["mounts"],
        json!([]),
        "mounts is always present, even empty"
    );
}

fn mount(source: Option<&str>, destination: &str) -> ContainerImageMount {
    ContainerImageMount {
        access: None,
        destination: destination.to_string(),
        device: None,
        driver: ContainerImageMountDriver::Local,
        size: None,
        source: source.map(str::to_string),
        type_: ContainerImageMountType::Bind,
    }
}

fn mapping(host_ip: &str, port: i64) -> ContainerImagePortMapping {
    ContainerImagePortMapping {
        container_port: port,
        guid: "guid".to_string(),
        host_ip: host_ip.to_string(),
        host_port: port,
        protocol: ContainerImagePortProtocol::Tcp,
    }
}
