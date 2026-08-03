//! The engine and its host — the two wire vocabularies the desktop app reads back.

use cdc_runtime::domain::types::engine::{
    ApiSurface, ContainerEngine, ContainerEngineHost, EngineContext, Presence,
};
use serde_json::json;

#[test]
fn a_context_deserializes_from_dockers_own_spelling() {
    // **The field names are the CLI's, not this crate's**, because this type is deserialized straight
    // from `docker context ls --format json`. A rename that drifted would leave every field at its
    // default and the list would render as rows of blanks — which is a plausible-looking answer.
    let line = r#"{"Current":true,"Description":"Docker Desktop","DockerEndpoint":"unix:///d.sock","Error":"","Name":"desktop-linux"}"#;
    assert_eq!(
        serde_json::from_str::<EngineContext>(line).expect("docker's own output parses"),
        EngineContext {
            current: true,
            description: "Docker Desktop".to_string(),
            endpoint: "unix:///d.sock".to_string(),
            error: String::new(),
            name: "desktop-linux".to_string(),
        }
    );
    // And it goes back out the same way — a client reads these off the wire.
    assert_eq!(
        serde_json::to_value(EngineContext {
            name: "colima".to_string(),
            endpoint: "unix:///c.sock".to_string(),
            ..EngineContext::default()
        })
        .unwrap(),
        json!({
            "Current": false,
            "Description": "",
            "DockerEndpoint": "unix:///c.sock",
            "Error": "",
            "Name": "colima",
        })
    );
}

#[test]
fn wire_values_match_the_shipping_app() {
    // These are persisted in user-settings.json and read by the desktop app. Apple's runtime
    // serialises as "container", not "apple" — the enum member name is not the wire value.
    assert_eq!(
        serde_json::to_value(ContainerEngine::Podman).unwrap(),
        json!("podman")
    );
    assert_eq!(
        serde_json::to_value(ContainerEngine::Apple).unwrap(),
        json!("container")
    );
    assert_eq!(
        serde_json::to_value(ContainerEngineHost::AppleNative).unwrap(),
        json!("container.native")
    );
    assert_eq!(
        serde_json::to_value(ContainerEngineHost::PodmanVirtualizedVendor).unwrap(),
        json!("podman.virtualized.vendor")
    );
}

#[test]
fn every_engine_host_suffix_is_classifiable() {
    // reachability/model.ts:resolveTransport infers transport from the dotted SUFFIX. A value whose
    // suffix does not classify would silently select the wrong hop diagram, so every one is checked.
    let all = [
        ContainerEngineHost::PodmanNative,
        ContainerEngineHost::PodmanVirtualizedWsl,
        ContainerEngineHost::PodmanVirtualizedLima,
        ContainerEngineHost::PodmanVirtualizedVendor,
        ContainerEngineHost::PodmanRemote,
        ContainerEngineHost::DockerNative,
        ContainerEngineHost::DockerVirtualizedWsl,
        ContainerEngineHost::DockerVirtualizedLima,
        ContainerEngineHost::DockerVirtualizedVendor,
        ContainerEngineHost::DockerRemote,
        ContainerEngineHost::AppleNative,
        ContainerEngineHost::AppleRemote,
    ];
    assert_eq!(
        all.len(),
        12,
        "the connector matrix is 12: podman x5, docker x5, apple x2"
    );

    for host in all {
        let wire = serde_json::to_value(host).unwrap();
        let value = wire.as_str().unwrap();
        let transport = if value.ends_with(".remote") {
            "ssh"
        } else if value.contains(".wsl") {
            "wsl"
        } else if value.contains(".lima") || value.contains(".vendor") {
            "vm"
        } else {
            "native"
        };
        assert!(
            ["ssh", "wsl", "vm", "native"].contains(&transport),
            "{value} did not classify"
        );
        // Native is the fallback arm, so it must be reached only by genuinely native values.
        if transport == "native" {
            assert!(
                value.ends_with(".native"),
                "{value} fell through to native by accident"
            );
        }
    }
}

#[test]
fn the_engine_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(ApiSurface::VOCABULARY);
    super::agrees_on_the_wire(ContainerEngine::VOCABULARY);
    super::agrees_on_the_wire(ContainerEngineHost::VOCABULARY);
    super::agrees_on_the_wire(Presence::VOCABULARY);
}
