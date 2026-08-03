//! The container-desktop connection runtime.
//!
//! A port of `src/packages/container-client/src` — same domain, same vocabulary, Rust mechanics.
//! `Connection`, `Connector`, `Transport`, `EngineDialect`, `HostProfile`, `HostClient`,
//! `StartupStatus`, `Presence`, `AvailabilityCheck` mean here exactly what they mean there.
//!
//! **This crate does not know where it is running.** It cannot open a file, spawn a process, read the
//! clock or reach the network — it has no dependency that could. What it needs from a machine it
//! DECLARES, as the traits in [`capabilities`], and a host crate implements them:
//!
//! | Crate | Implements the capabilities with |
//! |---|---|
//! | `cdc-runtime-host-native` | tokio processes, the real filesystem, `~/.ssh/config`, the clock |
//! | *(a `cdc-runtime-host-browser`)* | `fetch`, an exec bridge the embedder supplies, `Date.now()` |
//!
//! That is the whole boundary, and it is enforced by the compiler rather than by review: a host crate
//! depends on this one, never the reverse, so nothing here can reach for a facility. The wasm gate —
//! `cargo check -p cdc-runtime --no-default-features --target wasm32-unknown-unknown`, run by
//! `make test-core` and by CorePipeline.yml — then proves the consequence: this crate compiles to
//! `wasm32-unknown-unknown`, so a Go CLI, a Node
//! CLI, a Rust CLI or a browser can embed the same runtime and supply only its own adapters. The
//! capability traits are what make that true; a unit performing its own I/O *through* them is portable
//! for the same reason.
//!
//! ```text
//! types/         the domain model, named as `container-client/src/types/` names it
//! runtimes/      transports × dialects × profiles, the facade, the registry, the composed HostClient
//! capabilities/  what the runtime needs a host to be able to do: run, read/write, time, network
//! settings/      `user-settings.json` as a sequence of capability calls
//! ```

#![doc(html_no_source)]

pub mod adapters;
pub mod capabilities;
pub mod command_proxy;
pub mod domain;
pub mod runtimes;
pub mod settings;
