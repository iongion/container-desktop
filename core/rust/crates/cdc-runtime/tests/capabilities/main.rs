//! The capabilities — what a host must provide, and what the runtime may assume of it.
//!
//! No file of its own, and why: `clock.rs` and `fs.rs` are trait declarations with no behaviour to
//! assert. What an adapter DOES with them belongs to the host crate, and is in
//! `cdc-runtime-host-native/tests/fs.rs`.

mod command;
mod http;
