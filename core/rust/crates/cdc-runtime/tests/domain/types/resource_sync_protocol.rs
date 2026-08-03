//! What a client is told: why a connection was opened, what phase it is in, and how far `starting`
//! has got.

use cdc_runtime::domain::types::resource_sync_protocol::{
    ConnectOrigin, ConnectionPhase, ConnectionStartingStep,
};

#[test]
fn the_snapshot_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(ConnectOrigin::VOCABULARY);
    super::agrees_on_the_wire(ConnectionPhase::VOCABULARY);
    super::agrees_on_the_wire(ConnectionStartingStep::VOCABULARY);
}
