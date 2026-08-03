//! The composed runtime — `container-client/src/runtimes/`.
//!
//! Transports × dialects × profiles, the connector table that pairs them, and the `HostClient` that
//! composes one of each and IS the context they are handed. Named as the original names it.

// The three unit contracts and the composed context they receive.
pub mod composition;

// The units themselves.
pub mod dialects;
pub mod profiles;
pub mod transports;

// Which resource fields a client may sort, which the dialect's capability base carries.
pub mod sort_capabilities;

// The client that composes one of each and IS that context.
pub mod host_client;

// The twelve connectors and the units each is composed from.
pub mod registry;
