//! Reading and mutating `user-settings.json` as a document.
//!
//! Pure: the paths, the merge and every mutation are plain functions over `serde_json::Value`, so
//! the whole of the design's compatibility story is a unit test. Locking, atomic rename and change
//! detection are I/O and live in `cdc-runtime`.

pub mod document;
pub mod merge;
pub mod paths;
