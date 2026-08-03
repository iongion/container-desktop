//! The domain — the model, the composition units, and the connection lifecycle.
//!
//! Named as `src/packages/container-client/src` names it. Host-free: everything it needs a machine
//! to do it asks of the [`crate::capabilities`] traits. What proves that is the wasm gate in
//! `make test-core` — a facility this module reached for directly would fail to compile there. (An
//! earlier `cargo xtask purity` compared dependency lists; it went with the design's generator, and it
//! was the weaker check anyway: feature unification means a dependency list cannot see the reach.)

// Argv rules and timeout constants.
pub mod argv;

// What a unit refuses with: a code, never prose.
pub mod diagnostic;

// The domain model. Hand-written, mirroring `container-client/src/types/`.
pub mod types;

// `compose/` — so far only the labels a stack is stamped with, which the container normalizer reads.
pub mod compose;

// The binaries a connection is made of — `connection.ts`.
pub mod connection;

// `normalizers/` — an engine's raw answer made canonical. Keyed on the API surface, not the engine.
pub mod normalizers;

// Detection: what the engine and the machine say they are.
pub mod detect;

// `user-settings.json` as a document: the merge, the connection CRUD and the path resolution the
// desktop app uses. Pure, so the design's whole compatibility story is a unit test.
// Path joining with the OS as a parameter, so the Windows rules are checkable from anywhere.
pub mod pathing;

// `logs.ts` — a container log body read back out of what a carrier delivered. The bytes are the
// carrier's; the framing is the reader's.
pub mod logs;

// Finding a program and its version — three lookups, two of them unverifiable from this machine.
pub mod program;

// `proxy.ts` — what a connection's engine processes are told about leaving this machine.
pub mod proxy;

// Where a host path lands when this process is inside a flatpak sandbox — one rule, two call sites.
pub mod sandbox;

// The connection lifecycle: one machine per connection, with reconnect as a state and a
// back-off that is deterministic. `active_connections` holds many of them and no "current" — it is
// NOT the original's `registry.ts`, which is the connector table and lives in `runtimes`.
pub mod active_connections;
pub mod machine;
pub mod reconnect;

pub mod settings;

// The SSH transport's pure parts: the argv is the observable behaviour, so it is
// specified here rather than assembled in the runtime.
pub mod ssh;

// Version resolution and its three exceptions — ssh, cosign, wsl.exe.
pub mod version;

// The argv that reaches an engine inside a WSL distribution — `wsl-args.ts`. Pure for the reason
// `ssh/args.rs` is: the argv IS the observable behaviour.
pub mod wsl_args;
