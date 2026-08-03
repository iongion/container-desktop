# cdc — the Rust connection core

A port of `src/packages/container-client/src`.

## Crates

Every subsystem is generic first and gets host adapters second, one host crate per subsystem per
platform.

| Crate | What it is | Constraint |
|---|---|---|
| `cdc-runtime` | The domain, the composition units, the capability declarations, settings | **No host.** Compiles to `wasm32-unknown-unknown` |
| `cdc-runtime-host-native` | Processes, filesystem, paths, `~/.ssh/config` | Depends on `cdc-runtime`, never the reverse |
| `cdc-telemetry` | Span vocabulary, the privacy allowlist, `SpanRecord` + the `TraceSink` seam | Zero dependencies |
| `cdc-telemetry-host-native` | A real OTLP/HTTP exporter, the sink over it, the `tracing` bridge | The only crate that knows OpenTelemetry exists |

A second platform is additive — a `cdc-runtime-host-browser` and its telemetry sibling change nothing
above them.

## Commands

```sh
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo fmt --all --check

# cdc-runtime still has no host. NOT redundant with the workspace build: features unify across a
# workspace, so a host crate's `tokio/process` is enabled for the runtime too and hides exactly this.
cargo check -p cdc-runtime --no-default-features \
  --target wasm32-unknown-unknown --target-dir target/wasm-gate --locked

# The test bar, both halves.
cargo llvm-cov --workspace --show-missing-lines --fail-under-lines 99
cargo mutants                # every mutant must be caught
```

`make test-core` from the repo root runs all of it.

## The test bar: every line executed AND 100% mutants

Line coverage says a line RAN. A surviving mutant says a line ran and **nothing checked what it did**.
Both are gates rather than aspirations, and `cargo mutants` is configured in
[`.cargo/mutants.toml`](.cargo/mutants.toml).

**`cargo mutants` must report `0 missed` and `0 timeouts`.** A timeout is not a pass: it means the
suite HUNG on that mutation rather than failing, so bound any test whose failure mode is a hang
(`cdc-runtime-host-native/tests/connection.rs` wraps its cancellation test in `tokio::time::timeout`
for exactly that reason).

**`--show-missing-lines` must print no `Uncovered Lines` section.** That, not the percentage, is the
"every line ran" check. The percentage stops just short of 100 because llvm-cov counts a generic
function once PER INSTANTIATION, so a function instantiated for five types but exercised for two
reads as missed in the other three however complete the tests are. Proven rather than assumed —
changing `poll_for_lock`'s `impl FnMut` to `&mut dyn FnMut` took `fs.rs` from one missed line to none
without touching a single test. The gate is `--fail-under-lines 99` plus an empty missing-lines list;
do not chase the last fraction by turning injected generics into trait objects, which is designing
for the tool.

Three rules follow:

- **A guard is verified by breaking it.** A test nobody has watched fail is not known to work.
- **`cargo mutants` runs only the MUTATED PACKAGE's tests.** A behaviour pinned only from another
  crate reads as a surviving mutant — mutate `cdc-runtime-host-native` and nothing in
  `cdc-runtime/tests/` runs. Each crate's tests must stand on their own. `llvm-cov` will not tell
  you, because it is workspace-wide; this is what moving code between packages walks into.
- **Assert values that DISTINGUISH.** `ConnectionRegistry::len()` was covered and asserted — as
  `== 1`, which the mutant "always return 1" satisfies too.

## Layout conventions

- **`src/` mirrors `container-client/src` module for module.** Same file name, same job. A reader
  with the TypeScript open should not have to search.
- **Tests live in `crates/<crate>/tests/`, a sibling of `src/`** — never `#[cfg(test)] mod tests`
  inside a source file. Shared helpers go in `tests/fakes/`.
- **620 lines maximum per file, comments excluded.** `Application.ts` (1749 lines) is what this rule
  exists to prevent.
- **No re-export barrels.** `lib.rs` declares modules with `pub mod` and stops there; callers import
  from the module that defines the item. Same rule as the TypeScript side.

## Engineering rules

**Idiomatic Rust for MECHANICS; the original's vocabulary for the DOMAIN.** Reach for the type
system — `Result` and `?` over sentinel returns, enums and exhaustive `match` over string tags,
newtypes over stringly-typed ids, `Option` over "empty string means absent", borrows over cloning.
That freedom stops at naming: `Transport`, `EngineDialect`, `HostProfile`, `HostClient`,
`StartupStatus`, `Presence`, `AvailabilityCheck`, `Connector` mean here what they mean in
`container-client`. **A concept the original does not have is designed before it is written, not
explained in a comment afterwards** — the port has already been rebuilt once for ignoring that.

**Dependencies are injected, never reached for.** Collaborators arrive through constructors as
generic parameters or trait objects when dynamic dispatch is genuinely needed. No globals, no
singletons, no lazily-initialised statics, no ambient `Command` the way the TypeScript global works —
that global is exactly what forced the app's tests to monkey-patch `globalThis`. Injection is what
lets a test swap in a fake capability with no mocking framework at all.

**Logging is `tracing`, and only in the host crates.** `cdc-runtime-host-native`, `cdc-server` and
`cdc-client` instrument with `tracing`; spans carry the connection id so concurrent connections stay
readable. `cdc-runtime` does not log; it returns structured diagnostics, which a caller
can assert in a way log lines never are.

## The rule worth knowing before you edit

**`cdc-runtime` knows no host.** Everything it needs a machine to do it asks of a trait in
`capabilities/`, and a host crate implements it. The dependency direction is the compiler's job — a
host crate depends on the runtime, never the reverse — and the wasm build above is what proves the
consequence. A unit that performs its own I/O
*through* a capability is portable for exactly the same reason; performing I/O is not what would
break this.
