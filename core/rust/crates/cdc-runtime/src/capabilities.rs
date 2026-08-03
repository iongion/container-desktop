//! What this runtime needs a machine to be able to do — and its only view of the outside world.
//!
//! Four capabilities: `Command`, `Fs`, `Clock`, `Http`. Declarations only — nothing here is
//! implemented, and a host crate supplies each one. Async lives at this layer and no deeper: the
//! kernel in `domain/` never sees these definitions, which is why a planner stays a plain function.
//!
//! Swapping a host's implementation for a recording one makes the whole domain observable, and
//! that is how corpus replay works without a runtime at all.

pub mod clock;
pub mod command;
pub mod fs;
pub mod http;
