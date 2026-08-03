//! The headless connection server.
//!
//! It speaks the shapes the desktop app already has — `resourceSyncProtocol.ts` and
//! `commandProxyProtocol.ts` — rather than a parallel REST surface nobody else implements. Those
//! were designed for main-to-renderer IPC, but nothing about their SHAPES is
//! shell-specific, and adopting them gives the Go implementation a precise target instead of a
//! prose description.
//!
//! **The transport is separated from the protocol, and there is deliberately no local shortcut.** A
//! second code path for the local case is how two paths drift, so the local Unix socket and the
//! remote WebSocket carry byte-identical envelopes and differ only in the listener that accepts them.

pub mod cli;

pub mod host;

pub mod listen;

pub mod protocol;

pub mod queue;

pub mod server;

pub mod slots;

pub mod streams;

pub mod supervise;
