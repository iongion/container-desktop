# Testing

The verification gate is **type-check · lint · unit tests · production build** — all enforced on
every PR and push to `main` by
[`.github/workflows/CIPipeline.yml`](../.github/workflows/CIPipeline.yml). That is the **CI**
pipeline; the `CDPipeline.*` files (`CDPipeline.Tauri.yml` default, plus `.Wails`) are the separate **release/publish** pipelines and run no checks.

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

### UI suites (the real app over W3C WebDriver)

Config: [`webdriver/wdio.conf.js`](../webdriver/wdio.conf.js). The specs drive the running Tauri app —
there is no CDP in a native webview. UI specs run against deterministic **mock** fixtures
(`CONTAINER_DESKTOP_MOCK=<engine>`); the swarm spec also sets
`CONTAINER_DESKTOP_MOCK_SWARM=manager|none` to render the populated vs "Initialize Swarm" states — no
Docker required.

```bash
yarn test:e2e:tauri:mock:podman   # inventory counts, podman fixtures
yarn test:e2e:tauri:mock:docker   # inventory counts, docker fixtures
yarn test:e2e:tauri:swarm         # swarm tabs (manager)
yarn test:e2e:tauri:swarm:none    # the Initialize Swarm empty state
```

Real-engine specs need a NON-mock app (`CONTAINER_DESKTOP_MOCK=`) and a configured target in
`src/__tests__/live/targets.env`. They drive `window.__cdLiveProbe` /
`window.__cdExecutionMatrixProbe` — DEV-gated seams that run the SHIPPED ports inside the webview, so
one probe covers both backends:

```bash
yarn test:e2e:tauri:connections         # the connectivity matrix
yarn test:e2e:tauri:execution-targets   # off-host worker execution
yarn test:e2e:tauri:swarm:live          # real Docker Swarm (use support/swarm-sandbox.sh up)
```

## AI subsystem (two lenses)

The agentic AI subsystem (`@/ai-system`: Assistant chat + Runs multi-agent DAG + Workers with container
"Runs on" execution) is covered by **two complementary lenses** that test the SAME behaviors:

- **Mock lens** — deterministic, hermetic, CI-capable. The scripted `omaMocks` brain + the seeded
  `createMockTeamRuns`/`createMockWorkerStore` fixtures drive scale, both approval branches, and every task
  state without a network. This is what the unit suite and the mock UI flows run.
- **Live lens** — the REAL model/agent path against **OpenRouter free models only**, run by hand, **never in
  CI**, skipped loud when the key is absent.

### Mock lens — scale + UI branches

Drive the running mock app (`yarn dev:mock`) over WebDriver. The Runs UI is stressed at scale
with an env knob — synthetic runs are appended to the baked fixtures:

```bash
CONTAINER_DESKTOP_MOCK_SCALE="runs:300,tasks:100" yarn dev:mock
```

`runs:N` seeds N finished/active Runs for the list; `tasks:N` seeds one plan-gate run (`scale-plan`, clamped
to `MAX_RUN_TASKS`) plus a mixed-state twin (`scale-graph`) whose tasks span every `RunTaskStatus`. Counts are
schema-valid so they survive the client-bridge validation.

The **AI e2e flows** ([`support/e2e/ai/flows.mjs`](../support/e2e/ai/flows.mjs)) drive the real running app
through a backend-agnostic `AiE2eDriver` (WebdriverIO on Tauri, MCP on Wails) and assert
**both branches** of each gate — chat echo/reply, run plan Approve **and** Reject, tool approval Allow **and**
Reject, task-node output vs the "Waiting…" placeholder, Stop, and the Workers library round-trip:

```bash
yarn dev:mock        # in one shell
yarn test:e2e:ai     # attaches to that app (never launches a second one)
```

The mutating flows each **create their own run** (re-runnable); read-only checks reuse the always-present baked
`mock-run-*` fixtures. Those baked runs are interactive: a seed run emits granular events on approve/reject/stop
(`aiMocks.ts` `attachEmit` → the run host's per-run broadcast), so gate actions reflect in the live UI exactly
like a real run.

### Live lens — real OpenRouter inference

[`src/__tests__/live/ai-agent.live.test.ts`](../src/__tests__/live/ai-agent.live.test.ts) exercises the real
provider stack (`createLanguageModel` → `AISdkAdapter` → open-multi-agent) against OpenRouter: a real assistant
turn streams per free model, and a **multi-inference** Team Run puts two workers on two DIFFERENT free models —
proven by a recording `providerFetch` that captures the `model` of every request body (routing is asserted, not
the noisy free-tier output).

```bash
# key in .env.development.local (gitignored):  OPENROUTER_API_KEY=sk-or-...
yarn test:ai:live
```

Skips loud when `OPENROUTER_API_KEY` is unset. The shared free-model roster lives in
[`testing/agents.ts`](../src/packages/ai-system/src/testing/agents.ts) (`OPENROUTER_FREE_MODELS`) — **verify the
ids before a run** (`curl -s https://openrouter.ai/api/v1/models`, filter `:free`); the free roster shifts
weekly. The free tier is rate-limited (~20/min, 50/day unfunded), so the arms run sequentially with a courtesy
delay and treat a refusal/rate-limit as skipped, not failed.

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
| AI e2e flows (both branches)   | [`support/e2e/ai/flows.mjs`](../support/e2e/ai/flows.mjs)                     |
| Live AI (OpenRouter)           | [`src/__tests__/live/ai-agent.live.test.ts`](../src/__tests__/live/ai-agent.live.test.ts) |
| Shared worker/model fixtures   | [`src/packages/ai-system/src/testing/agents.ts`](../src/packages/ai-system/src/testing/agents.ts) |
| Run scale seeders              | [`src/packages/ai-system/src/testing/scaleRuns.ts`](../src/packages/ai-system/src/testing/scaleRuns.ts) |
