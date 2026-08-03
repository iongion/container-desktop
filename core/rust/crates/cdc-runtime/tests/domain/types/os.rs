//! The scope-type discriminator, whose SSH spelling is the one that surprises.

use cdc_runtime::domain::types::os::{ControllerScopeType, OperatingSystem};
use serde_json::json;

#[test]
fn the_ssh_discriminator_is_spelled_ssh_connection() {
    // The SSH discriminator is "SSHConnection", not "SSHHost".
    assert_eq!(
        serde_json::to_value(ControllerScopeType::SshConnection).unwrap(),
        json!("SSHConnection")
    );
}

#[test]
fn the_os_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(ControllerScopeType::VOCABULARY);
    super::agrees_on_the_wire(OperatingSystem::VOCABULARY);
}
