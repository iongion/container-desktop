//! The domain — `cdc-runtime/src/domain/`, one test file per source file.
//!
//! Cargo roots a multi-file test target at `<dir>/main.rs`, and a crate root resolves `mod` against
//! its OWN directory — which is why this is `main.rs` and not `domain.rs`, and why the shared modules
//! one level up arrive by path. Everything below it mirrors `src/domain/` exactly; a subdirectory
//! appears only where the 600-line cap forced one file into several.
//!
//! No file of its own, and why: `connection.rs` is program NAMES and nothing else; `diagnostic.rs` is
//! a code plus its parameters, asserted at every refusal in this tree rather than in isolation.

#[path = "../fakes/mod.rs"]
mod fakes;
#[path = "../harness/mod.rs"]
mod harness;

mod active_connections;
mod argv;
mod compose;
mod detect;
mod logs;
mod machine;
mod normalizers;
mod pathing;
mod program;
mod proxy;
mod reconnect;
mod sandbox;
mod settings;
mod ssh;
mod types;
mod version;
mod wsl_args;
