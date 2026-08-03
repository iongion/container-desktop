//! `user-settings.json` over the `Fs` capability: the locked write path and change detection.
//!
//! The document itself — the merge, the CRUD, the migration, the path rule — is pure and lives in
//! `crate::domain::settings`. What is left here is the I/O SEQUENCE, and it is portable: every file
//! operation goes through the capability, so a host that stores settings in `localStorage` or in a Go
//! caller's memory gets this logic unchanged. Where the file physically lives is the host's answer
//! (`crate::host::native::paths`).

pub mod store;
pub mod watch;
