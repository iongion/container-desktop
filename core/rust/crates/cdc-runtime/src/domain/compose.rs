//! `compose/` — the stack layer. Only its LABELS are here so far, because only they have a reader:
//! the container normalizer groups by them, and the translator that writes them stays in TypeScript.

pub mod labels;
