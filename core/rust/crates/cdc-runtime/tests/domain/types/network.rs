//! A network, and the proxy vocabularies.

use cdc_runtime::domain::types::network::{ConnectionProxyMode, Network, ProxyMode, ProxyProtocol};
use serde_json::json;

#[test]
fn a_subnet_without_a_lease_window_reads_as_the_empty_one() {
    // libpod answers a subnet with no `lease_range` at all; the canonical shape still has the field.
    let network: Network = serde_json::from_value(json!({
        "name": "podman",
        "subnets": [{"subnet": "10.88.0.0/16", "gateway": "10.88.0.1"}],
        "labels": null,
        "options": null
    }))
    .expect("a libpod network");

    assert_eq!(network.subnets[0].lease_range.start_ip, "");
    assert!(network.labels.is_empty());
    assert!(network.options.is_empty());
}

#[test]
fn the_proxy_vocabularies_agree_with_themselves_on_the_wire() {
    super::agrees_on_the_wire(ConnectionProxyMode::VOCABULARY);
    super::agrees_on_the_wire(ProxyMode::VOCABULARY);
    super::agrees_on_the_wire(ProxyProtocol::VOCABULARY);
}
