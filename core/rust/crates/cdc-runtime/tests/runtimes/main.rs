//! The runtimes — `cdc-runtime/src/runtimes/`, one test file per source file.
//!
//! `composition.rs` is the CONTRACT: what every trait requires of its implementations and what it
//! defaults for them. A leaf's own OS gate and API ranking belong to the leaf, in `profiles/`.

#[path = "../fakes/mod.rs"]
mod fakes;

mod composition;
mod dialects;
mod host_client;
mod profiles;
mod registry;
mod transports;
