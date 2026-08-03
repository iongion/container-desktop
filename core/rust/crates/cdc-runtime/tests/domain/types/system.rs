//! What an engine says about itself, and what it says it is storing.

use cdc_runtime::domain::types::system::{SystemDf, SystemInfo};
use serde_json::json;

#[test]
fn a_real_info_answer_reads_the_guests_os_not_this_hosts() {
    let info: SystemInfo = serde_json::from_value(json!({
        "host": {
            "os": "linux",
            "kernel": "7.0.0-28-generic",
            "hostname": "workstation",
            "distribution": {"distribution": "ubuntu", "variant": "", "version": "25.10"},
            "remoteSocket": {"exists": true, "path": "/run/user/1000/podman/podman.sock"}
        },
        "plugins": null,
        "registries": {"search": ["docker.io"]},
        "store": {"configFile": "/home/x/.config/containers/storage.conf"},
        "version": {"Version": "5.7.0", "APIVersion": "5.7.0"}
    }))
    .expect("a real libpod info");

    assert_eq!(info.host.distribution.distribution, "ubuntu");
    assert!(info.plugins.is_empty());
    assert_eq!(info.registries.get("search").map(Vec::len), Some(1));
    assert_eq!(info.version.version, "5.7.0");
}

#[test]
fn a_disk_usage_summary_writes_the_apps_own_lowercase_keys() {
    let written = serde_json::to_value(SystemDf {
        images_count: 9,
        images_reclaimable: 17_624,
        images_size: 701_505_876,
        reclaimable_count: 8,
    })
    .expect("a summary serializes");

    assert_eq!(
        written,
        json!({
            "imagesCount": 9,
            "imagesReclaimable": 17_624,
            "imagesSize": 701_505_876,
            "reclaimableCount": 8
        })
    );
}
