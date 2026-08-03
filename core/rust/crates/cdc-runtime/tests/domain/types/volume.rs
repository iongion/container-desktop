//! A volume — the same shape on both surfaces, and the one whose SIZES are optional on purpose.

use cdc_runtime::domain::types::volume::Volume;
use serde_json::json;

#[test]
fn a_real_podman_volume_reads_whole() {
    let volume: Volume = serde_json::from_value(json!({
        "Name": "bf80f95ed5fb",
        "Driver": "local",
        "Mountpoint": "/home/x/.local/share/containers/storage/volumes/bf80f95ed5fb/_data",
        "CreatedAt": "2026-07-06T21:49:51.149237545+02:00",
        "Labels": {},
        "Scope": "local",
        "Options": {},
        "Anonymous": true,
        "MountCount": 0
    }))
    .expect("a real libpod volume");

    assert!(volume.anonymous);
    assert_eq!(
        volume.usage_data, None,
        "libpod's list never measures a volume"
    );
}

#[test]
fn a_real_docker_volume_answers_null_options() {
    let volume: Volume = serde_json::from_value(json!({
        "CreatedAt": "2026-06-06T23:38:19+02:00",
        "Driver": "local",
        "Labels": {"com.docker.volume.anonymous": ""},
        "Mountpoint": "/var/lib/docker/volumes/d580e4645b2f/_data",
        "Name": "d580e4645b2f",
        "Options": null,
        "Scope": "local"
    }))
    .expect("a real docker volume");

    assert!(volume.options.is_empty());
}

#[test]
fn a_measured_volume_carries_its_usage_and_an_unmeasured_one_writes_no_key() {
    let measured: Volume =
        serde_json::from_value(json!({"Name": "v", "UsageData": {"Size": 12, "RefCount": 2}}))
            .expect("a volume listed with ?size=true");
    assert_eq!(measured.usage_data.expect("usage").size, 12);

    let written = serde_json::to_value(Volume::default()).expect("a volume serializes");
    assert!(
        !written
            .as_object()
            .expect("an object")
            .contains_key("UsageData"),
        "an unmeasured volume must not claim a size of zero"
    );
}
