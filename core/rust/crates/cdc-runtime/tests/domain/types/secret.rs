//! A secret's metadata, as libpod really answers it.

use cdc_runtime::domain::types::secret::Secret;
use serde_json::json;

#[test]
fn a_real_secret_reads_whole() {
    let secret: Secret = serde_json::from_value(json!({
        "ID": "10731ccdf200b953774b94223",
        "CreatedAt": "2026-06-16T12:18:19.190139732+02:00",
        "UpdatedAt": "2026-06-16T12:18:19.190139732+02:00",
        "Spec": {
            "Name": "test",
            "Driver": {"Name": "file", "Options": {"path": "/home/x/secrets/filedriver"}},
            "Labels": null
        }
    }))
    .expect("a real libpod secret");

    assert_eq!(secret.spec.name, "test");
    assert_eq!(secret.spec.driver.name, "file");
    assert_eq!(secret.spec.driver.options.len(), 1);
}

#[test]
fn a_driver_without_options_reads_as_the_empty_map() {
    let secret: Secret =
        serde_json::from_value(json!({"ID": "s", "Spec": {"Driver": {"Options": null}}}))
            .expect("a secret whose driver takes no options");

    assert!(secret.spec.driver.options.is_empty());
}
