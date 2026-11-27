# Testing

The verification gate is **type-check · lint · unit tests · production build** — all enforced on
every PR and push to `main` by
[`.github/workflows/CIPipeline.yml`](../.github/workflows/CIPipeline.yml). That is the **CI**
pipeline; `CDPipeline.Tauri.yml` is the separate **release/publish** pipeline and runs no checks.

## JS/TS — Vitest

Config: [`vitest.config.mts`](../vitest.config.mts) — jsdom, `@ → src`, collects
`src/**/*.{test,spec}.{ts,tsx}`, excludes `*.live.test.ts`.

```bash
pnpm test        # watch
pnpm test:run    # one-shot (what CI runs)
```

Tests import explicitly (`import { describe, it, expect } from "vitest"` — `globals: false`).

### Running container-client under plain Node (headless)

The engine logic in `src/container-client/` reads `Command` / `Platform` / `Path` / `FS` /
`CURRENT_OS_TYPE` as globals that each shell's host bridge assigns at startup. The shared setup
file [`src/__tests__/setup/headless.ts`](../src/__tests__/setup/headless.ts) wires the **safe**
ones (`Platform`/`Path`/`FS` — thin `node:` adapters in
[`nodeTestHost.ts`](../src/__tests__/setup/nodeTestHost.ts)) so the whole connection layer runs under
Vitest with **no shell**. It deliberately does **not** install a spawning `Command`: real process
execution happens inside a shell, over WebDriver.

### Faking `Command` (no real processes)

Tests that exercise command execution install a recording fake with
[`installFakeCommand()`](../src/__tests__/setup/fakeCommand.ts):

```ts
import { afterEach } from "vitest";
import { installFakeCommand } from "@/__tests__/setup/fakeCommand";

const cmd = installFakeCommand((call) =>
  call.args.includes("--version") ? { stdout: "podman 5.0.0" } : {},
);
afterEach(() => cmd.restore());
// assert on cmd.calls — every Execute / Spawn / ExecuteAsBackgroundService, in order
```

It implements **every** `ICommand` member (availability/tunnel paths call
`CreateNodeJSApiDriver` + `ExecuteAsBackgroundService`, so a partial fake would crash them),
and `ProxyRequest` returns `200`/`"OK"` by default. Shape per-call results to simulate failures
(`{ success: false, stderr }`).

### The real-machine target registry

Every real-engine and real-model check now runs on WebDriver against the shipped shell (below), so the
node-level live project ([`vitest.live.config.mts`](../vitest.live.config.mts), `pnpm test:live`) is **empty** —
it stays as the home for a future `*.live.test.ts`, and passes with no tests rather than failing.

What survives, and what the WebDriver live specs read, is the machine registry: copy
[`src/__tests__/live/targets.example.env`](../src/__tests__/live/targets.example.env) to `targets.env`
(gitignored), fill in the `CDT_TARGET_*` entries, and select with `CONTAINER_DESKTOP_TEST_TARGETS=<id>`.
`tsx src/__tests__/live/printTargets.ts` lists what is configured.

**Docker Swarm** runs against a **disposable local sandbox**, never your primary daemon — swarm is Docker-only
(not Podman/Apple). Bring one up, point the `swarm` target's `_DOCKER_SOCKET` at it, run the UI spec, tear down:

```bash
support/swarm-sandbox.sh up          # single-node (docker:dind); or `up-multi` for node ops
pnpm test:smoke:tauri --spec webdriver/smoke/swarm.smoke.js
support/swarm-sandbox.sh down
```

### UI suites (the real app over W3C WebDriver)

Config: [`webdriver/wdio.conf.js`](../webdriver/wdio.conf.js). The specs drive the running Tauri app —
there is no CDP in a native webview. UI specs run against deterministic **mock** fixtures
(`CONTAINER_DESKTOP_MOCK=<engine>`); the swarm spec also sets
`CONTAINER_DESKTOP_MOCK_SWARM=manager|none` to render the populated vs "Initialize Swarm" states — no
Docker required. `CONTAINER_DESKTOP_MOCK_CONNECTED=none` is the one scenario the mock could not otherwise
reach: an app that boots with NO engine connected. It is decided by `mockAvailability()` alone — the engine
service reads a connection's `running` off `availability.api` and brings the primary connection up whether or
not anything is flagged auto-start, so clearing auto-start does not express it.

On Linux the app never shows a window on your desktop
([`webdriver/support/headlessDisplay.js`](../webdriver/support/headlessDisplay.js), pagecast's method):

- Each session starts a private headless **sway**; the app gets its socket as `WAYLAND_DISPLAY` and no `DISPLAY`,
  so GTK cannot fall back onto the desktop. It keeps the real `XDG_RUNTIME_DIR`, where the engine sockets live.
- It renders on the first GPU that is not NVIDIA's (mesa-only EGL), or in software when there is none.
- `CONTAINER_DESKTOP_E2E_HEADLESS=0` shows the window, to watch a spec. Without sway the run stops and names the
  fix (`bash support/provision-deps.sh`).
- `displayServerEnabled: false` is load-bearing: WebdriverIO otherwise starts its own display server whenever
  `DISPLAY` is unset, and the worker died on `write EINVAL`.
- A run killed mid-way leaves nothing running. Ctrl-C makes WebdriverIO SIGKILL its worker, which runs no exit
  handler, so sway and tauri-driver start under `setpriv --pdeathsig KILL` and the kernel ends them with it. The
  next session removes the dead run's directory.

One entry point per suite — `pnpm test:e2e:tauri` runs the mock suite ([below](#two-suites-told-apart-by-what-a-failure-is-allowed-to-mean));
`--spec` selects one and the scenario travels in the environment, so there is no script per combination:

```bash
CONTAINER_DESKTOP_MOCK=podman pnpm test:e2e:tauri --spec webdriver/specs/mock-inventory.e2e.js
CONTAINER_DESKTOP_MOCK=docker pnpm test:e2e:tauri --spec webdriver/specs/mock-inventory.e2e.js
CONTAINER_DESKTOP_MOCK=docker CONTAINER_DESKTOP_MOCK_SWARM=manager pnpm test:e2e:tauri --spec webdriver/specs/swarm-ui.e2e.js
CONTAINER_DESKTOP_MOCK=docker CONTAINER_DESKTOP_MOCK_SWARM=none pnpm test:e2e:tauri --spec webdriver/specs/swarm-ui.e2e.js
```

On Windows, prefix with `pnpm cross-env` instead of a shell assignment.

A spec whose scenario knob has a default asserts what EACH scenario should produce, naming it in the
`describe` title — `swarm-ui.e2e.js` and `landing-ui.e2e.js` are the two, so a default suite run is never
vacuous and neither needs a gate:

```bash
CONTAINER_DESKTOP_MOCK=podman CONTAINER_DESKTOP_MOCK_CONNECTED=none \
  pnpm test:e2e:tauri --spec webdriver/specs/landing-ui.e2e.js
```

Real-engine specs live in the **smoke** suite, which has its own entry point (`pnpm test:smoke:tauri` clears
`CONTAINER_DESKTOP_MOCK` for you) and a configured target in `src/__tests__/live/targets.env`. They drive
`window.__cdLiveProbe` — a DEV-gated seam that runs the SHIPPED ports inside the webview, so one probe covers
both backends:

```bash
pnpm test:smoke:tauri --spec webdriver/smoke/connection-matrix.smoke.js   # the connectivity matrix
pnpm test:smoke:tauri --spec webdriver/smoke/swarm.smoke.js               # real Docker Swarm
```

## Two suites, told apart by what a failure is allowed to mean

| | `webdriver/specs/*.e2e.js` | `webdriver/smoke/*.smoke.js` |
| --- | --- | --- |
| Runs against | the **mock app only** — fixtures, no engine, no account, no network | **real integration**: real engines, real machines |
| A failure means | the app is wrong. Nothing else is involved | either the app is wrong **or** something outside it was missing — so it must not be allowed to mean the first by default |
| Entry point | `pnpm test:e2e:tauri` | `pnpm test:smoke:tauri` (clears `CONTAINER_DESKTOP_MOCK`) |
| Gating | **none, ever.** Nothing is absent, so nothing may be skipped | **skips** when its subject is absent, naming what was missing |

A mock spec carries no gate because there is nothing for it to be missing: gating one would only hide a
real defect. A smoke spec's *subject is the integration*, so when the engine, the machine or the sandbox
is not there, there is nothing to prove — failing would blame the app for the
operator's environment, and passing would claim coverage nobody has. It reports **SKIP** with the command
that fixes it ([`webdriver/support/prerequisites.js`](../webdriver/support/prerequisites.js)): a VM that is
shut off must never read as five failing hosts. A machine answering on 22 is not the same question as the engine
it declares being up — win11 boots long before Docker Desktop does, and its CLI answers while the daemon behind it
does not — so a remote target's engine is asked separately, over plain ssh (`remoteEngineReason`).

Nothing in that helper starts anything. Bringing a VM up or standing up a sandbox are the operator's
decisions, never a test's — and a gate that skips something
which *would* have run is worse than no gate at all, because the report then looks like it ran.

```bash
pnpm test:e2e:tauri                                                    # the mock suite; must be green
pnpm test:smoke:tauri                                                  # real integration; skips what is absent
pnpm test:smoke:tauri --spec webdriver/smoke/connection-matrix.smoke.js
```

## MCP server

Three bands, cheapest first:

- **Protocol core** (Vitest, hermetic): `src/packages/mcp-server/tests/` drives `handleMcpMessage` over a fake
  `EngineOps` — the handshake and versions, the tool catalogue per mode, argument validation, refusals, redaction.
- **Native listener** (`cargo test --lib mcp`): the request rules (Host, Origin, token, path, method, version, size),
  the listener on a free port with a fake webview, the token store, and the stdio relay against that listener.
- **The mock app** (`webdriver/specs/mcp-server.e2e.js`): turns the server on in Settings, reads the endpoint and
  token from the panel, then speaks MCP from the spec — handshake, read-only listing and refusal, the switch to
  allow, a 403 for a foreign `Origin` and a 401 for a wrong token. The mock engine is stateless, so a stop is
  proven by its result, not by the row changing. The run keeps its token in its own data dir, never the OS keychain.

```bash
pnpm test:e2e:tauri --spec webdriver/specs/mcp-server.e2e.js
```

## Build tooling (`support/cli/`)

The `pnpm cli` build/dev/release CLI has its own Vitest specs (`support/cli/**/*.test.ts`) that run
as part of `pnpm test:run`, and is type-checked and linted by the same gate:

```bash
pnpm check-types   # tsc (app) + tsc -p support/cli/tsconfig.json
pnpm lint:check    # biome check ./src ./support/cli
pnpm test:run      # includes support/cli/**/*.test.ts
```

## CI jobs

[`CIPipeline.yml`](../.github/workflows/CIPipeline.yml) runs a single job:

| Job     | Does                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------- |
| **app** | `pnpm check-types` · `pnpm lint:check` · `pnpm test:run` · `ENVIRONMENT=production pnpm build` |

## Source map

| Piece                          | Path                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| CI gate                        | [`.github/workflows/CIPipeline.yml`](../.github/workflows/CIPipeline.yml)     |
| Headless globals / live opt-in | [`src/__tests__/setup/headless.ts`](../src/__tests__/setup/headless.ts)       |
| Recording `Command` fake       | [`src/__tests__/setup/fakeCommand.ts`](../src/__tests__/setup/fakeCommand.ts) |
| Vitest config                  | [`vitest.config.mts`](../vitest.config.mts)                                   |
| MCP protocol units             | [`src/packages/mcp-server/tests/`](../src/packages/mcp-server/tests)           |
| MCP end to end (mock app)      | [`webdriver/specs/mcp-server.e2e.js`](../webdriver/specs/mcp-server.e2e.js) |
