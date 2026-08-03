//! `runtimes/transports/` — scope mechanics, one per host TYPE.
//!
//! All five are ported: native, SSH, WSL, podman-machine and LIMA.

pub mod lima;
pub mod native;
pub mod podman_machine;
pub mod ssh;
pub mod wsl;

// The settings reads every scoped transport starts from.
pub mod shared;
