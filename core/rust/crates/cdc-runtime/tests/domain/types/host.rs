//! What starting a scope answered.

use cdc_runtime::domain::types::host::StartupStatus;

#[test]
fn a_startup_status_agrees_with_itself_on_the_wire() {
    super::agrees_on_the_wire(StartupStatus::VOCABULARY);
}
