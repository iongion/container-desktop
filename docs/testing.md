# Testing

The verification gate is **type-check · lint · unit tests · production build** — all enforced on
every PR and push to `main` by
[`.github/workflows/CIPipeline.yml`](../.github/workflows/CIPipeline.yml). That is the **CI**
pipeline; the `CDPipeline.*` files (`CDPipeline.Tauri.yml` default, plus `.Electron` / `.Wails`) are the separate **release/publish** pipelines and run no checks.

## JS/TS — Vitest

Config: [`vitest.config.mts`](../vitest.config.mts) — jsdom, `@ → src`, collects
`src/**/*.{test,spec}.{ts,tsx}`, excludes `*.live.test.ts`.

```bash
yarn test        # watch
yarn test:run    # one-shot (what CI runs)
```

Tests import explicitly (`import { describe, it, expect } from "vitest"` — `globals: false`).

### Running container-client under plain Node (headless)

The engine logic in `src/container-client/` reads `Command` / `Platform` / `Path` / `FS` /
`CURRENT_OS_TYPE` as globals that Electron's main/preload assign at startup. The shared setup
file [`src/__tests__/setup/headless.ts`](../src/__tests__/setup/headless.ts) wires the **safe**
ones (`Platform`/`Path`/`FS` — pure Node reads) so the whole connection layer runs under Vitest
with **no Electron**. It deliberately does **not** install a spawning `Command`.

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

### Live suite (real engines)

`*.live.test.ts` files are excluded from the hermetic run and drive a **real** engine/VM;
[`installRealCommand()`](../src/__tests__/setup/headless.ts) wires the real Node executor for them.

Config: [`vitest.live.config.mts`](../vitest.live.config.mts) (node env, 60s timeouts). Select machines
via the `CDT_TARGET_*` registry — copy [`src/__tests__/live/targets.example.env`](../src/__tests__/live/targets.example.env)
to `targets.env` (gitignored) and set `CONTAINER_DESKTOP_TEST_TARGETS=<id>`.

```bash
yarn test:live                                         # every ENABLED target
CONTAINER_DESKTOP_TEST_TARGETS=swarm yarn test:live    # just the swarm target
```

**Docker Swarm** (`swarm.live.test.ts`) runs against a **disposable local sandbox**, never your primary
daemon — swarm is Docker-only (not Podman/Apple). Bring one up, point the `swarm` target's
`_DOCKER_SOCKET` at it, run, tear down:

```bash
support/swarm-sandbox.sh up          # single-node (docker:dind); or `up-multi` for node ops
CONTAINER_DESKTOP_TEST_TARGETS=swarm yarn test:live
support/swarm-sandbox.sh down
```

### UI suite (real Electron over CDP)

Config: [`vitest.ui.config.mts`](../vitest.ui.config.mts). Launches the built app with Playwright
([`src/__tests__/ui/app-harness.ts`](../src/__tests__/ui/app-harness.ts)) — needs
`cross-env ENVIRONMENT=production yarn build` first, and a display (or `CONTAINER_DESKTOP_HEADLESS=1`).
UI tests run against deterministic **mock** fixtures (`CONTAINER_DESKTOP_MOCK=<engine>`); the swarm UI
test also sets `CONTAINER_DESKTOP_MOCK_SWARM=manager|none` to render the populated vs "Initialize Swarm"
states — no Docker required.

```bash
yarn test:ui
```

## Build tooling (`support/cli/`)

The `yarn cli` build/dev/release CLI has its own Vitest specs (`support/cli/**/*.test.ts`) that run
as part of `yarn test:run`, and is type-checked and linted by the same gate:

```bash
yarn check-types   # tsc (app) + tsc -p support/cli/tsconfig.json
yarn lint:check    # biome check ./src ./support/cli
yarn test:run      # includes support/cli/**/*.test.ts
```

## CI jobs

[`CIPipeline.yml`](../.github/workflows/CIPipeline.yml) runs a single job:

| Job     | Does                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------- |
| **app** | `yarn check-types` · `yarn lint:check` · `yarn test:run` · `ENVIRONMENT=production yarn build` |

## Source map

| Piece                          | Path                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| CI gate                        | [`.github/workflows/CIPipeline.yml`](../.github/workflows/CIPipeline.yml)     |
| Headless globals / live opt-in | [`src/__tests__/setup/headless.ts`](../src/__tests__/setup/headless.ts)       |
| Recording `Command` fake       | [`src/__tests__/setup/fakeCommand.ts`](../src/__tests__/setup/fakeCommand.ts) |
| Vitest config                  | [`vitest.config.mts`](../vitest.config.mts)                                   |
