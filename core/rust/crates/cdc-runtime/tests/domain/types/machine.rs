//! The scope union — untagged, and deterministic only because of its `Type` discriminator.

use cdc_runtime::domain::types::machine::{
    ControllerScope, LimaInstanceType, PodmanMachineType, WslDistributionType,
};
use serde_json::json;

#[test]
fn controller_scope_union_discriminates_on_type() {
    // The union is untagged, so it would otherwise match by required-field luck. The typed `Type`
    // discriminator is what makes it deterministic.
    let ssh = json!({
        "Name": "win11", "Type": "SSHConnection", "Host": "win11",
        "Port": 22, "HostName": "192.168.122.5", "User": "istoica", "IdentityFile": "~/.ssh/id_ed25519"
    });
    let scope: ControllerScope =
        serde_json::from_value(ssh).expect("should deserialize as SSHHost");
    assert!(matches!(scope, ControllerScope::SshHost(_)));

    let wsl = json!({
        "Name": "Ubuntu", "Type": "WSLDistribution",
        "State": "Running", "Version": "2", "Default": true, "Current": false
    });
    let scope: ControllerScope = serde_json::from_value(wsl).expect("should deserialize as WSL");
    assert!(matches!(scope, ControllerScope::WslDistribution(_)));
}

#[test]
fn a_wrong_discriminator_is_rejected() {
    let bogus = json!({
        "Name": "win11", "Type": "NotAScopeType", "Host": "win11",
        "Port": 22, "HostName": "192.168.122.5", "User": "istoica", "IdentityFile": "~/.ssh/id"
    });
    assert!(
        serde_json::from_value::<ControllerScope>(bogus).is_err(),
        "an unknown Type must not fall through to some other variant"
    );
}

#[test]
fn the_scope_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(LimaInstanceType::VOCABULARY);
    super::agrees_on_the_wire(PodmanMachineType::VOCABULARY);
    super::agrees_on_the_wire(WslDistributionType::VOCABULARY);
}
