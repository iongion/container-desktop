//! `runtimes/dialects/` — engine commands and endpoints, one per engine.
//!
//! What every dialect owes the TRAIT — its engine, its API surface, and whether it describes a
//! bridge — is asserted in [`super::composition`], beside the trait that requires it.

mod container;
mod docker;
mod docker_contexts;
mod podman;
mod podman_machine_connections;
mod podman_machine_pipe;
mod podman_machine_ssh;
mod shared;
