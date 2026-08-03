//! The SSH transport's pure parts.
//!
//! SSH shells out to the system `ssh` rather than embedding a library, so the argv IS the observable
//! behaviour and belongs in the pure domain where the corpus can pin it.

pub mod args;
pub mod forward;
pub mod preflight;
