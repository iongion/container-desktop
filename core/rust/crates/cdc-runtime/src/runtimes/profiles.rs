//! `runtimes/profiles/` — the thin per-(engine, host) glue, one per leaf.
//!
//! Arranged as the original arranges it: one module per ENGINE, plus the shared module holding the
//! platform gates and the leaves whose bodies are identical across engines — SSH (all THREE engines),
//! WSL and LIMA. Each of those is one struct carrying its host as data, never a copy per engine.

pub mod container;
pub mod docker;
pub mod podman;
pub mod shared;
