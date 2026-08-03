//! `runtimes/transports/shared.ts` — what more than one transport needs.
//!
//! Four accessors over settings and scopes, each one line, and one line is where a wrong constant
//! hides: a `scope_name` that read the wrong field would select the wrong scope, and a
//! `scope_usable` that read an absent `Usable` as true would probe an engine inside a stopped VM.

use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::runtimes::transports::shared::{scope_name, scope_usable};
use serde_json::json;

/// A scope of each kind, from the WIRE spelling a transport parses — so a renamed key is caught here
/// and not only where that transport lists them.
fn scope(kind: &str, name: &str, usable: serde_json::Value) -> ControllerScope {
    let mut fields = json!({ "Type": kind, "Name": name, "Usable": usable });
    let extra = match kind {
        "PodmanMachine" => {
            json!({"Active": true, "Created": "c", "LastUp": "l", "Running": true, "VMType": "qemu"})
        }
        "WSLDistribution" => {
            json!({"Current": false, "Default": true, "State": "Running", "Version": "2"})
        }
        "LIMAInstance" => {
            json!({"Arch": "aarch64", "CPUs": "4", "Dir": "/d", "Disk": "100GiB", "Memory": "4GiB", "SSH": "60022", "Status": "Running"})
        }
        _ => {
            json!({"Host": name, "HostName": "192.168.122.5", "IdentityFile": "", "Port": 22, "User": "tester"})
        }
    };
    let object = fields.as_object_mut().expect("fields");
    for (key, value) in extra.as_object().expect("extra") {
        object.insert(key.clone(), value.clone());
    }
    serde_json::from_value(fields).expect("the scope fixture parses")
}

/// Every kind, in the order `ControllerScope` declares them.
fn every_kind(usable: serde_json::Value) -> [ControllerScope; 4] {
    [
        scope("PodmanMachine", "podman-machine-default", usable.clone()),
        scope("WSLDistribution", "Ubuntu", usable.clone()),
        scope("LIMAInstance", "default", usable.clone()),
        scope("SSHConnection", "win11", usable),
    ]
}

#[test]
fn a_scope_names_itself_the_same_way_whatever_kind_it_is() {
    // Matching `settings.controller.scope` against a scope is how one is selected, and selecting must
    // not need to know which kind it is looking at — every kind carries `Name`.
    assert_eq!(
        every_kind(json!(true))
            .iter()
            .map(scope_name)
            .collect::<Vec<_>>(),
        vec!["podman-machine-default", "Ubuntu", "default", "win11"]
    );
}

#[test]
fn a_scope_that_was_never_assessed_is_not_usable() {
    // `Usable` is filled in by whoever LISTED the scope, so an absent one means nobody looked, and
    // reading it as usable is how detection ends up probing an engine inside a stopped VM. Only a
    // podman machine REQUIRES the key; the other three may arrive without it.
    for usable in every_kind(json!(true)) {
        assert!(scope_usable(&usable), "{usable:?}");
    }
    for refused in every_kind(json!(false)) {
        assert!(!scope_usable(&refused), "{refused:?}");
    }
    for absent in [
        scope("WSLDistribution", "Ubuntu", json!(null)),
        scope("LIMAInstance", "default", json!(null)),
        scope("SSHConnection", "win11", json!(null)),
    ] {
        assert!(!scope_usable(&absent), "{absent:?} was never assessed");
    }
}
