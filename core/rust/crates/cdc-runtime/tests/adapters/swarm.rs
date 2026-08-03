//! The swarm adapter: the 503 rule, the read-modify-writes, and the derived stacks.
//!
//! **These fixtures are NOT captures**, unlike every other file in this target: this machine runs no
//! swarm, and `docker swarm init` on the primary daemon is not something a test may do. They are shaped
//! from Docker's documented responses and from `types/swarm.rs`, which means they prove the PATHS, the
//! BODIES and the status rule — not that Docker's fields are spelled the way this reads them. The suite
//! that proves the shapes is the live one, against `support/swarm-sandbox.sh up`.

use cdc_runtime::adapters::base_urls::LIFECYCLE_TIMEOUT;
use cdc_runtime::adapters::shared::AdapterError;
use cdc_runtime::adapters::swarm;
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::types::engine::ApiSurface;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::swarm::{
    NodeUpdateOptions, SwarmConfigCreateOptions, SwarmInitOptions, SwarmLeaveOptions,
    SwarmNodeAvailability, SwarmNodeRole, SwarmSecretCreateOptions,
};
use cdc_runtime::runtimes::dialects::docker::DockerDialect;
use cdc_runtime::runtimes::profiles::docker::DockerNativeProfile;
use cdc_runtime::runtimes::transports::native::NativeTransport;
use serde_json::{Map, Value, json};

use super::fakes::{FakeCommand, FakeHttp, unit_host, unit_settings};
use super::{asked, bound, only, refused, routed, serving};

/// Docker's own sentence, which is the whole reason the 503 is not an error.
const NOT_A_MANAGER: &str =
    r#"{"message":"This node is not a swarm manager. Use \"docker swarm init\"."}"#;

/// One service carrying a stack label, at version 11.
const SERVICE: &str = r#"{
  "ID": "svc1",
  "Version": {"Index": 11},
  "CreatedAt": "2026-01-01T00:00:00Z",
  "UpdatedAt": "2026-01-01T00:00:00Z",
  "Spec": {
    "Name": "web",
    "Labels": {"com.docker.stack.namespace": "shop"},
    "Mode": {"Replicated": {"Replicas": 1}},
    "TaskTemplate": {"ContainerSpec": {"Image": "nginx:latest"}}
  },
  "Endpoint": {"Ports": []}
}"#;

/// An engine that is not a swarm manager, whatever is asked of it.
fn not_a_manager() -> (cdc_runtime::adapters::shared::EngineApi, super::Log) {
    bound(
        ApiSurface::Docker,
        FakeHttp::scripted(|_| Ok(refused(503, "Service Unavailable", NOT_A_MANAGER))),
    )
}

#[tokio::test]
async fn a_list_on_a_node_that_is_not_a_swarm_manager_is_empty_rather_than_an_error() {
    let (api, _) = not_a_manager();

    // Every list takes the same route through `read_list`, so all five are the one rule.
    assert!(swarm::list_services(&api).await.expect("empty").is_empty());
    assert!(swarm::list_nodes(&api).await.expect("empty").is_empty());
    assert!(
        swarm::list_tasks(&api, None)
            .await
            .expect("empty")
            .is_empty()
    );
    assert!(swarm::list_secrets(&api).await.expect("empty").is_empty());
    assert!(swarm::list_configs(&api).await.expect("empty").is_empty());
    assert!(swarm::list_stacks(&api).await.expect("empty").is_empty());
}

#[tokio::test]
async fn an_inspect_on_a_node_that_is_not_a_swarm_manager_is_nothing_rather_than_an_error() {
    let (api, _) = not_a_manager();

    assert!(swarm::inspect(&api).await.expect("nothing").is_none());
    assert!(
        swarm::get_service(&api, "x")
            .await
            .expect("nothing")
            .is_none()
    );
    assert!(swarm::get_node(&api, "x").await.expect("nothing").is_none());
    assert!(
        swarm::get_secret(&api, "x")
            .await
            .expect("nothing")
            .is_none()
    );
    assert!(
        swarm::get_config(&api, "x")
            .await
            .expect("nothing")
            .is_none()
    );
}

#[tokio::test]
async fn any_other_refusal_still_reaches_the_caller() {
    // The rule is 503 and nothing else: a 500 is a broken engine and a 401 is a person's problem, and
    // answering `[]` to either is how a real failure becomes an empty screen.
    for (status, text) in [(500u16, "Internal Server Error"), (401, "Unauthorized")] {
        let (api, _) = bound(
            ApiSurface::Docker,
            FakeHttp::scripted(move |_| Ok(refused(status, text, r#"{"message":"no"}"#))),
        );

        let error = swarm::list_services(&api).await.expect_err("a refusal");

        let AdapterError::Refused { status: got, .. } = error else {
            panic!("expected a refusal, got {error:?}");
        };
        assert_eq!(got, status);
    }
}

#[tokio::test]
async fn every_swarm_route_is_the_connections_own_root() {
    // Swarm is Docker-only and the original pins `baseURL: DOCKER_BASE_URL`, whose prefix is empty — so
    // an unprefixed path is the faithful one, and it cannot be bent onto a libpod root by the surface.
    let (api, log) = serving(ApiSurface::Docker, "[]");

    swarm::list_services(&api).await.expect("a list");
    swarm::list_nodes(&api).await.expect("a list");
    swarm::list_secrets(&api).await.expect("a list");
    swarm::list_configs(&api).await.expect("a list");
    swarm::list_tasks(&api, None).await.expect("a list");

    let paths: Vec<String> = asked(&log).into_iter().map(|it| it.path).collect();
    assert_eq!(
        paths,
        vec!["/services", "/nodes", "/secrets", "/configs", "/tasks"]
    );
}

#[tokio::test]
async fn an_init_sends_the_default_listen_address_and_no_advertise_address() {
    let (api, log) = serving(ApiSurface::Docker, "\"\"");

    swarm::init(&api, &SwarmInitOptions::default())
        .await
        .expect("initialised");

    let request = only(&log);
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("POST", "/swarm/init")
    );
    let body: Value = serde_json::from_str(request.body.as_deref().expect("a body")).expect("json");
    assert_eq!(
        body,
        json!({
            "ListenAddr": "0.0.0.0:2377",
            "AdvertiseAddr": null,
            "ForceNewCluster": false,
        }),
        "the defaults are the original's, and `AdvertiseAddr` is sent absent rather than invented"
    );
}

#[tokio::test]
async fn an_init_carries_the_interface_the_user_picked() {
    let (api, log) = serving(ApiSurface::Docker, "\"\"");
    let opts = SwarmInitOptions {
        advertise_addr: Some("192.168.0.28".to_string()),
        force_new_cluster: Some(true),
        listen_addr: Some("0.0.0.0:7777".to_string()),
    };

    swarm::init(&api, &opts).await.expect("initialised");

    let body: Value =
        serde_json::from_str(only(&log).body.as_deref().expect("a body")).expect("json");
    assert_eq!(
        body,
        json!({
            "ListenAddr": "0.0.0.0:7777",
            "AdvertiseAddr": "192.168.0.28",
            "ForceNewCluster": true,
        })
    );
}

#[tokio::test]
async fn a_leave_says_whether_it_is_forced() {
    let (api, log) = serving(ApiSurface::Docker, "\"\"");

    swarm::leave(&api, &SwarmLeaveOptions::default())
        .await
        .expect("left");
    swarm::leave(&api, &SwarmLeaveOptions { force: Some(true) })
        .await
        .expect("left");

    let paths: Vec<String> = asked(&log).into_iter().map(|it| it.path).collect();
    assert_eq!(
        paths,
        vec!["/swarm/leave?force=false", "/swarm/leave?force=true"]
    );
}

#[tokio::test]
async fn the_cluster_lifecycle_gets_the_lifecycle_budget_and_not_the_hosts_default() {
    // Found by the live suite, not by reasoning: a forced `leave` on a manager that still has a service
    // does not answer within the host's 3000ms, so the default reported failure on a call the engine went
    // on to finish. `init` bootstraps the same Raft state.
    let (api, log) = routed(
        ApiSurface::Docker,
        &[("/services", 200, "[]"), ("/swarm", 200, "\"\"")],
    );

    swarm::init(&api, &SwarmInitOptions::default())
        .await
        .expect("initialised");
    swarm::leave(&api, &SwarmLeaveOptions::default())
        .await
        .expect("left");
    swarm::list_services(&api).await.expect("a list");

    let requests = asked(&log);
    assert_eq!(requests[0].timeout, Some(LIFECYCLE_TIMEOUT), "init");
    assert_eq!(requests[1].timeout, Some(LIFECYCLE_TIMEOUT), "leave");
    assert_eq!(
        requests[2].timeout, None,
        "and an ordinary read is left on the host's own budget"
    );
}

#[tokio::test]
async fn a_scale_reads_the_service_then_writes_its_spec_back_at_that_version() {
    // Docker's optimistic concurrency: the write carries the version the read saw, so a concurrent
    // change is refused rather than silently overwritten.
    let (api, log) = routed(
        ApiSurface::Docker,
        &[
            ("/services/svc1/update", 200, "{}"),
            ("/services/svc1", 200, SERVICE),
        ],
    );

    let sent = swarm::scale_service(&api, "svc1", 5).await.expect("scaled");

    assert!(sent);
    let requests = asked(&log);
    assert_eq!(requests[0].path, "/services/svc1");
    assert_eq!(
        (requests[1].method.as_str(), requests[1].path.as_str()),
        ("POST", "/services/svc1/update?version=11")
    );
    let body: Value =
        serde_json::from_str(requests[1].body.as_deref().expect("a body")).expect("json");
    assert_eq!(
        body.pointer("/Mode/Replicated/Replicas"),
        Some(&json!(5)),
        "the replica count is the only thing that changed"
    );
    assert_eq!(
        body.pointer("/Name"),
        Some(&json!("web")),
        "and the rest of the spec is sent back as it was read — a partial spec is a destructive update"
    );
}

#[tokio::test]
async fn an_update_merges_the_patch_over_the_spec_that_is_already_there() {
    let (api, log) = routed(
        ApiSurface::Docker,
        &[
            ("/services/svc1/update", 200, "{}"),
            ("/services/svc1", 200, SERVICE),
        ],
    );
    let mut patch = Map::new();
    patch.insert("Labels".to_string(), json!({ "role": "edge" }));

    swarm::update_service(&api, "svc1", &patch)
        .await
        .expect("updated");

    let body: Value =
        serde_json::from_str(asked(&log)[1].body.as_deref().expect("a body")).expect("json");
    assert_eq!(body.pointer("/Labels"), Some(&json!({ "role": "edge" })));
    assert_eq!(
        body.pointer("/TaskTemplate/ContainerSpec/Image"),
        Some(&json!("nginx:latest")),
        "a key the patch does not name survives"
    );
}

#[tokio::test]
async fn a_service_with_no_version_is_not_written_to_at_all() {
    // The one thing a refusal cannot express: nothing was sent. An update with no version would be a
    // write Docker rejects, so the original answers `false` and this must too.
    let (api, log) = serving(ApiSurface::Docker, r#"{"ID":"svc1","Spec":{"Name":"web"}}"#);

    let sent = swarm::scale_service(&api, "svc1", 5)
        .await
        .expect("no write");

    assert!(!sent);
    assert_eq!(
        asked(&log).len(),
        1,
        "the read happened and nothing followed it"
    );
}

#[tokio::test]
async fn a_service_that_is_not_there_is_not_written_to_either() {
    let (api, log) = not_a_manager();

    let sent = swarm::scale_service(&api, "svc1", 5)
        .await
        .expect("no write");

    assert!(!sent);
    assert_eq!(asked(&log).len(), 1);
}

#[tokio::test]
async fn stacks_are_derived_from_the_service_labels_and_counted() {
    const SERVICES: &str = r#"[
      {"ID":"a","Spec":{"Name":"web","Labels":{"com.docker.stack.namespace":"shop"}}},
      {"ID":"b","Spec":{"Name":"api","Labels":{"com.docker.stack.namespace":"shop"}}},
      {"ID":"c","Spec":{"Name":"solo","Labels":{}}},
      {"ID":"d","Spec":{"Name":"db","Labels":{"com.docker.stack.namespace":"blog"}}}
    ]"#;
    let (api, log) = serving(ApiSurface::Docker, SERVICES);

    let stacks = swarm::list_stacks(&api).await.expect("the stacks");

    assert_eq!(only(&log).path, "/services", "a stack is not a REST object");
    let seen: Vec<(&str, i64)> = stacks
        .iter()
        .map(|it| (it.name.as_str(), it.services))
        .collect();
    assert_eq!(
        seen,
        vec![("shop", 2), ("blog", 1)],
        "two services in one stack count as two, an unlabelled service is in none, and the order is \
         first-seen rather than alphabetical"
    );
    assert!(stacks.iter().all(|it| it.orchestrator == "Swarm"));
}

#[tokio::test]
async fn a_task_list_for_one_service_filters_on_it() {
    let (api, log) = serving(ApiSurface::Docker, "[]");

    swarm::list_tasks(&api, Some("svc1")).await.expect("a list");

    assert_eq!(
        only(&log).path,
        "/tasks?filters=%7B%22service%22%3A%5B%22svc1%22%5D%7D",
        "the filter is JSON in a query parameter, encoded as one component"
    );
}

#[tokio::test]
async fn a_node_update_sends_both_fields_and_falls_back_to_what_the_node_carries() {
    const NODE: &str = r#"{
      "ID":"n1","Version":{"Index":7},
      "Spec":{"Role":"manager","Availability":"active","Labels":{}}
    }"#;
    let (api, log) = routed(
        ApiSurface::Docker,
        &[("/nodes/n1/update", 200, "{}"), ("/nodes/n1", 200, NODE)],
    );
    let opts = NodeUpdateOptions {
        availability: Some(SwarmNodeAvailability::Drain),
        role: None,
    };

    let sent = swarm::update_node(&api, "n1", &opts)
        .await
        .expect("updated");

    assert!(sent);
    let requests = asked(&log);
    assert_eq!(requests[1].path, "/nodes/n1/update?version=7");
    let body: Value =
        serde_json::from_str(requests[1].body.as_deref().expect("a body")).expect("json");
    assert_eq!(body.pointer("/Availability"), Some(&json!("drain")));
    assert_eq!(
        body.pointer("/Role"),
        Some(&json!("manager")),
        "the role was not asked to change, so the node's own is sent back — omitting it demotes a manager"
    );
}

#[tokio::test]
async fn a_node_with_no_role_or_availability_is_sent_the_engines_own_defaults() {
    let (api, log) = routed(
        ApiSurface::Docker,
        &[
            ("/nodes/n1/update", 200, "{}"),
            (
                "/nodes/n1",
                200,
                r#"{"ID":"n1","Version":{"Index":3},"Spec":{}}"#,
            ),
        ],
    );

    swarm::update_node(&api, "n1", &NodeUpdateOptions::default())
        .await
        .expect("updated");

    let body: Value =
        serde_json::from_str(asked(&log)[1].body.as_deref().expect("a body")).expect("json");
    assert_eq!(body.pointer("/Role"), Some(&json!("worker")));
    assert_eq!(body.pointer("/Availability"), Some(&json!("active")));
}

#[tokio::test]
async fn a_node_update_can_promote() {
    let (api, log) = routed(
        ApiSurface::Docker,
        &[
            ("/nodes/n1/update", 200, "{}"),
            (
                "/nodes/n1",
                200,
                r#"{"ID":"n1","Version":{"Index":3},"Spec":{"Role":"worker"}}"#,
            ),
        ],
    );
    let opts = NodeUpdateOptions {
        availability: None,
        role: Some(SwarmNodeRole::Manager),
    };

    swarm::update_node(&api, "n1", &opts)
        .await
        .expect("updated");

    let body: Value =
        serde_json::from_str(asked(&log)[1].body.as_deref().expect("a body")).expect("json");
    assert_eq!(body.pointer("/Role"), Some(&json!("manager")));
}

#[tokio::test]
async fn a_cluster_secret_and_config_are_created_with_their_data_base64_encoded() {
    // Docker takes `Data` base64 and answers it base64. Sending the raw value creates a secret whose
    // body the engine reads as something else entirely.
    let (api, log) = serving(ApiSurface::Docker, "{}");
    let secret = SwarmSecretCreateOptions {
        data: "s3cr3t".to_string(),
        labels: Default::default(),
        name: "token".to_string(),
    };
    let config = SwarmConfigCreateOptions {
        data: "a: b\n".to_string(),
        labels: Default::default(),
        name: "conf".to_string(),
    };

    swarm::create_secret(&api, &secret).await.expect("created");
    swarm::create_config(&api, &config).await.expect("created");

    let requests = asked(&log);
    assert_eq!(requests[0].path, "/secrets/create");
    assert_eq!(
        serde_json::from_str::<Value>(requests[0].body.as_deref().expect("a body")).expect("json"),
        json!({ "Name": "token", "Data": "czNjcjN0", "Labels": {} })
    );
    assert_eq!(requests[1].path, "/configs/create");
    assert_eq!(
        serde_json::from_str::<Value>(requests[1].body.as_deref().expect("a body")).expect("json"),
        json!({ "Name": "conf", "Data": "YTogYgo=", "Labels": {} }),
        "padded, because Docker decodes it with a padded decoder"
    );
}

#[tokio::test]
async fn every_write_route_is_addressed_by_an_encoded_id() {
    let (api, log) = serving(ApiSurface::Docker, "{}");

    swarm::create_service(&api, &json!({ "Name": "web" }))
        .await
        .expect("created");
    swarm::remove_service(&api, "a/b").await.expect("removed");
    swarm::remove_node(&api, "n 1", true)
        .await
        .expect("removed");
    swarm::remove_secret(&api, "s 1").await.expect("removed");
    swarm::remove_config(&api, "c 1").await.expect("removed");

    let requests = asked(&log);
    let seen: Vec<(&str, &str)> = requests
        .iter()
        .map(|it| (it.method.as_str(), it.path.as_str()))
        .collect();
    assert_eq!(
        seen,
        vec![
            ("POST", "/services/create"),
            ("DELETE", "/services/a%2Fb"),
            ("DELETE", "/nodes/n%201?force=true"),
            ("DELETE", "/secrets/s%201"),
            ("DELETE", "/configs/c%201"),
        ]
    );
}

/// Real `ip -4 -o addr show scope global`, one row, from the machine this was written on.
const IP_OUTPUT: &str =
    "2: enp4s0    inet 192.168.0.28/24 brd 192.168.0.255 scope global dynamic enp4s0\n";

#[tokio::test]
async fn the_advertise_candidates_come_from_ip_on_the_connections_own_host() {
    // NOT an engine call: a multi-NIC manager answers 400 "could not choose an IP address to
    // advertise", so the drawer has to offer the host's interfaces — read off the host, not the API.
    let command = FakeCommand::answering(|_| CommandExecutionResult::ok(IP_OUTPUT));
    let log = command.log();
    let host = unit_host(
        "host.default.docker.native",
        Box::new(NativeTransport),
        Box::new(DockerDialect),
        Box::new(DockerNativeProfile),
        OperatingSystem::Linux,
        command,
    );

    let found = swarm::list_advertise_candidates(&host, &unit_settings()).await;

    assert_eq!(
        log.lock().expect("asked").argv[0],
        vec!["ip", "-4", "-o", "addr", "show", "scope", "global"],
        "the whole argv, because a missing `-o` makes the output multi-line and unparseable"
    );
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].address, "192.168.0.28");
    assert_eq!(found[0].iface, "enp4s0");
}

#[tokio::test]
async fn a_host_with_no_ip_command_offers_no_candidates_rather_than_failing() {
    // Docker Desktop's VM has no `ip`. The original catches and answers `[]` so the drawer degrades to
    // free text, which is a working init rather than a dead one.
    let command = FakeCommand::answering(|_| CommandExecutionResult::failed(127, "not found"));
    let host = unit_host(
        "host.default.docker.native",
        Box::new(NativeTransport),
        Box::new(DockerDialect),
        Box::new(DockerNativeProfile),
        OperatingSystem::Linux,
        command,
    );

    let found = swarm::list_advertise_candidates(&host, &unit_settings()).await;

    assert!(found.is_empty(), "got {found:?}");
}

#[tokio::test]
async fn a_refusal_that_is_not_a_503_reaches_the_caller_of_an_inspect_too() {
    // The list rule and the inspect rule are separate code; testing one leaves the other free to
    // swallow a 500 as "nothing is there".
    let (api, _) = bound(
        ApiSurface::Docker,
        FakeHttp::scripted(|_| Ok(refused(500, "Internal Server Error", r#"{"message":"no"}"#))),
    );

    let error = swarm::get_service(&api, "svc1")
        .await
        .expect_err("a refusal");

    let AdapterError::Refused { status, .. } = error else {
        panic!("expected a refusal, got {error:?}");
    };
    assert_eq!(status, 500);
}

#[tokio::test]
async fn the_cluster_itself_reads_whole() {
    const SWARM: &str = r#"{
      "ID": "cluster1",
      "Version": {"Index": 26},
      "CreatedAt": "2026-01-01T00:00:00Z",
      "UpdatedAt": "2026-01-01T00:00:00Z",
      "Spec": {"Name": "default", "Labels": {}},
      "JoinTokens": {"Manager": "SWMTKN-1-mgr", "Worker": "SWMTKN-1-wkr"}
    }"#;
    let (api, log) = serving(ApiSurface::Docker, SWARM);

    let info = swarm::inspect(&api)
        .await
        .expect("a cluster")
        .expect("present");

    assert_eq!(only(&log).path, "/swarm");
    assert_eq!(info.id, "cluster1");
    assert_eq!(info.spec.name, "default");
    assert_eq!(
        (
            info.join_tokens.manager.as_str(),
            info.join_tokens.worker.as_str()
        ),
        ("SWMTKN-1-mgr", "SWMTKN-1-wkr"),
        "the join tokens are the whole point of an inspect — they are what another node needs"
    );
}

#[tokio::test]
async fn a_node_a_cluster_secret_and_a_cluster_config_each_read_whole() {
    const NODE: &str = r#"{
      "ID": "n1", "Version": {"Index": 7},
      "Spec": {"Role": "manager", "Availability": "active", "Labels": {}},
      "Description": {"Hostname": "box", "Platform": {"Architecture": "x86_64", "OS": "linux"},
                      "Engine": {"EngineVersion": "29.7.0"}, "Resources": {"NanoCPUs": 8, "MemoryBytes": 16}},
      "Status": {"State": "ready", "Addr": "192.168.0.28"},
      "ManagerStatus": {"Leader": true, "Reachability": "reachable", "Addr": "192.168.0.28:2377"}
    }"#;
    const SECRET: &str = r#"{
      "ID": "s1", "Version": {"Index": 3},
      "Spec": {"Name": "token", "Labels": null}
    }"#;
    const CONFIG: &str = r#"{
      "ID": "c1", "Version": {"Index": 4},
      "Spec": {"Name": "conf", "Data": "YTogYgo=", "Labels": null}
    }"#;

    let (api, _) = serving(ApiSurface::Docker, NODE);
    let node = swarm::get_node(&api, "n1")
        .await
        .expect("a node")
        .expect("present");
    assert_eq!(node.description.hostname, "box");
    assert_eq!(node.spec.role, Some(SwarmNodeRole::Manager));
    assert!(node.manager_status.leader);

    let (api, _) = serving(ApiSurface::Docker, SECRET);
    let secret = swarm::get_secret(&api, "s1")
        .await
        .expect("a secret")
        .expect("present");
    assert_eq!(secret.spec.name, "token");
    assert_eq!(secret.version.index, 3);

    let (api, _) = serving(ApiSurface::Docker, CONFIG);
    let config = swarm::get_config(&api, "c1")
        .await
        .expect("a config")
        .expect("present");
    assert_eq!(
        config.spec.data, "YTogYgo=",
        "a config answers its Data where a secret does not, and it stays base64 as the engine sent it"
    );
}

#[tokio::test]
async fn a_spec_whose_mode_is_not_an_object_is_replaced_rather_than_written_into() {
    // `spec.Mode = spec.Mode ?? {}` in the original leaves a Mode that is a STRING in place and then
    // assigns into it. Here the entry has to become an object first, or the replica count would be
    // dropped on the floor and the scale would report success having changed nothing.
    const ODD: &str =
        r#"{"ID":"svc1","Version":{"Index":2},"Spec":{"Name":"web","Mode":"replicated"}}"#;
    let (api, log) = routed(
        ApiSurface::Docker,
        &[
            ("/services/svc1/update", 200, "{}"),
            ("/services/svc1", 200, ODD),
        ],
    );

    let sent = swarm::scale_service(&api, "svc1", 3).await.expect("scaled");

    assert!(sent);
    let body: Value =
        serde_json::from_str(asked(&log)[1].body.as_deref().expect("a body")).expect("json");
    assert_eq!(body.pointer("/Mode/Replicated/Replicas"), Some(&json!(3)));
}

#[tokio::test]
async fn a_service_labelled_with_an_empty_stack_name_belongs_to_no_stack() {
    // `if (!namespace) continue` in the original: an empty label is falsy there, and a stack called ""
    // is not something a person can act on.
    const SERVICES: &str = r#"[
      {"ID":"a","Spec":{"Name":"web","Labels":{"com.docker.stack.namespace":""}}},
      {"ID":"b","Spec":{"Name":"api","Labels":{"com.docker.stack.namespace":"shop"}}}
    ]"#;
    let (api, _) = serving(ApiSurface::Docker, SERVICES);

    let stacks = swarm::list_stacks(&api).await.expect("the stacks");

    let seen: Vec<&str> = stacks.iter().map(|it| it.name.as_str()).collect();
    assert_eq!(seen, vec!["shop"]);
}

#[tokio::test]
async fn a_service_reads_whole_including_the_version_a_write_has_to_echo() {
    let (api, _) = serving(ApiSurface::Docker, SERVICE);

    let service = swarm::get_service(&api, "svc1")
        .await
        .expect("a service")
        .expect("present");

    assert_eq!(service.id, "svc1");
    assert_eq!(service.version.index, 11);
    assert_eq!(service.spec.name, "web");
    assert_eq!(
        service.spec.mode.replicated.expect("replicated").replicas,
        1
    );
    assert_eq!(
        service.spec.task_template.container_spec.image,
        "nginx:latest"
    );
}
