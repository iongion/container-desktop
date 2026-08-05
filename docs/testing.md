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

### The real-machine target registry

Every real-engine and real-model check now runs on WebDriver against the shipped shell (below), so the
node-level live project ([`vitest.live.config.mts`](../vitest.live.config.mts), `yarn test:live`) is **empty** —
it stays as the home for a future `*.live.test.ts`, and passes with no tests rather than failing.

What survives, and what the WebDriver live specs read, is the machine registry: copy
[`src/__tests__/live/targets.example.env`](../src/__tests__/live/targets.example.env) to `targets.env`
(gitignored), fill in the `CDT_TARGET_*` entries, and select with `CONTAINER_DESKTOP_TEST_TARGETS=<id>`.
`tsx src/__tests__/live/printTargets.ts` lists what is configured.

**Docker Swarm** runs against a **disposable local sandbox**, never your primary daemon — swarm is Docker-only
(not Podman/Apple). Bring one up, point the `swarm` target's `_DOCKER_SOCKET` at it, run the UI spec, tear down:

```bash
support/swarm-sandbox.sh up          # single-node (docker:dind); or `up-multi` for node ops
yarn test:smoke:tauri --spec webdriver/smoke/swarm.smoke.js
support/swarm-sandbox.sh down
```

### UI suites (the real app over W3C WebDriver)

Config: [`webdriver/wdio.conf.js`](../webdriver/wdio.conf.js). The specs drive the running Tauri app —
there is no CDP in a native webview. UI specs run against deterministic **mock** fixtures
(`CONTAINER_DESKTOP_MOCK=<engine>`); the swarm spec also sets
`CONTAINER_DESKTOP_MOCK_SWARM=manager|none` to render the populated vs "Initialize Swarm" states — no
Docker required.

One entry point per suite — `yarn test:e2e:tauri` runs the mock suite ([below](#two-suites-told-apart-by-what-a-failure-is-allowed-to-mean));
`--spec` selects one and the scenario travels in the environment, so there is no script per combination:

```bash
CONTAINER_DESKTOP_MOCK=podman yarn test:e2e:tauri --spec webdriver/specs/mock-inventory.e2e.js
CONTAINER_DESKTOP_MOCK=docker yarn test:e2e:tauri --spec webdriver/specs/mock-inventory.e2e.js
CONTAINER_DESKTOP_MOCK=docker CONTAINER_DESKTOP_MOCK_SWARM=manager yarn test:e2e:tauri --spec webdriver/specs/swarm-ui.e2e.js
CONTAINER_DESKTOP_MOCK=docker CONTAINER_DESKTOP_MOCK_SWARM=none yarn test:e2e:tauri --spec webdriver/specs/swarm-ui.e2e.js
```

On Windows, prefix with `yarn cross-env` instead of a shell assignment.

Real-engine specs live in the **smoke** suite, which has its own entry point (`yarn test:smoke:tauri` clears
`CONTAINER_DESKTOP_MOCK` for you) and a configured target in `src/__tests__/live/targets.env`. They drive
`window.__cdLiveProbe` — a DEV-gated seam that runs the SHIPPED ports inside the webview, so one probe covers
both backends:

```bash
yarn test:smoke:tauri --spec webdriver/smoke/connection-matrix.smoke.js   # the connectivity matrix
yarn test:smoke:tauri --spec webdriver/smoke/swarm.smoke.js               # real Docker Swarm
```

Sandbox execution (`webdriver/specs/sandbox-exec.e2e.js`) runs on the **mock** app instead: the
`__aiSandboxExecProbe` seam resolves a disposable sandbox target and round-trips a file through the
container-routed workspace, proving the real execution selector works inside the WebKitGTK realm:
`yarn test:e2e:tauri --spec webdriver/specs/sandbox-exec.e2e.js`.

## Two suites, told apart by what a failure is allowed to mean

| | `webdriver/specs/*.e2e.js` | `webdriver/smoke/*.smoke.js` |
| --- | --- | --- |
| Runs against | the **mock app only** — fixtures, no engine, no account, no network | **real integration**: real engines, real machines, a real account, a real model |
| A failure means | the app is wrong. Nothing else is involved | either the app is wrong **or** something outside it was missing — so it must not be allowed to mean the first by default |
| Entry point | `yarn test:e2e:tauri` | `yarn test:smoke:tauri` (clears `CONTAINER_DESKTOP_MOCK`) |
| Gating | **none, ever.** Nothing is absent, so nothing may be skipped | **skips** when its subject is absent, naming what was missing |

A mock spec carries no gate because there is nothing for it to be missing: gating one would only hide a
real defect. A smoke spec's *subject is the integration*, so when the engine, the machine, the image, the
account or the loaded model is not there, there is nothing to prove — failing would blame the app for the
operator's environment, and passing would claim coverage nobody has. It reports **SKIP** with the command
that fixes it ([`webdriver/support/prerequisites.js`](../webdriver/support/prerequisites.js)): a VM that is
shut off must never read as five failing hosts. A machine answering on 22 is not the same question as the engine
it declares being up — win11 boots long before Docker Desktop does, and its CLI answers while the daemon behind it
does not — so a remote target's engine is asked separately, over plain ssh (`remoteEngineReason`).

Nothing in that helper starts anything. Bringing a VM up, loading a model, standing up a sandbox and
building the agent image are the operator's decisions, never a test's — and a gate that skips something
which *would* have run is worse than no gate at all, because the report then looks like it ran.

```bash
yarn test:e2e:tauri                                                    # the mock suite; must be green
yarn test:smoke:tauri                                                  # real integration; skips what is absent
yarn test:smoke:tauri --spec webdriver/smoke/connection-matrix.smoke.js
```

## AI subsystem

The assistant is a **pi coding agent running in a container** (see
[`architecture/ai-subsystem.md`](architecture/ai-subsystem.md)), so its coverage is in four bands: units on
both sides of the bridge, UI specs driven through the bridge, probes against a real container, and real-model
runs.

### Units (hermetic, CI)

Both halves are ordinary Vitest and run in `yarn test:run`:

- **Renderer side** — the bridge codec, the transcript projection (`piSessionView`), card resolution
  (`piToolCards`), the permission policy (`piApprovals`, `permissions`, `commandFloor`), host-request routing
  (`uiRequests`), `engineOpDispatch`, `pluginCatalog`, providers, the model probe (`modelWindow`) against each
  provider's real listing shape, the context report (`piContextReport`), redaction, the stores.
- **Container side** — every `pi-agent-host` module: session, host RPC, permission gate, container tools and
  their catalogue, model registrations, surfaces, tool surfaces, virtual terminal, UI context, plugins,
  resources, gateway, events, theme.

### UI specs — the mock app over WebDriver

The mock app boots a **scripted pi session** (`testing/mockPiBridge.ts`): the same `PiBridgeClient` the real
session uses, speaking the same bridge events, with no engine, no container and no model. So the Assistant
answers, renders cards and raises approval prompts through its production path. Specs that want a specific
frame still push it through the DEV-only `window.__cdCodingAgentStore` seam. Start `yarn dev:mock` in one
shell, then:

```bash
yarn test:e2e:tauri --spec webdriver/specs/extension-ui.e2e.js        # T1 — native dialogs, chrome, widgets       (5)
yarn test:e2e:tauri --spec webdriver/specs/pi-tool-cards.e2e.js       # T2 — tool results as typed cards           (12)
yarn test:e2e:tauri --spec webdriver/specs/pi-surfaces.e2e.js         # T3 — pi components as ANSI surfaces        (10)
yarn test:e2e:tauri --spec webdriver/specs/pi-plugins.e2e.js          # plugin install / enable / update / remove  (8)
yarn test:e2e:tauri --spec webdriver/specs/pi-container-tools.e2e.js  # the container toolset over a driven bridge (9)
yarn test:e2e:tauri --spec webdriver/specs/pi-start-drawer.e2e.js     # the session-start drawer                   (6)
yarn test:e2e:tauri --spec webdriver/specs/pi-model-chip.e2e.js       # the model a session answers with           (6)
yarn test:e2e:tauri --spec webdriver/specs/pi-model-reasoning.e2e.js  # the thinking levels a provider published   (4)
yarn test:e2e:tauri --spec webdriver/specs/pi-turn-facts.e2e.js       # an empty turn; a window with no room       (3)
yarn test:e2e:tauri --spec webdriver/specs/pi-session-points.e2e.js   # the fork and branch points pi answers with (6)
yarn test:e2e:tauri --spec webdriver/specs/assistant-screen.e2e.js    # the screen, its bar and its theme          (4)
yarn test:e2e:tauri --spec webdriver/specs/assistant-soundness.e2e.js # what it says about its own session         (7)
yarn test:e2e:tauri --spec webdriver/specs/assistant-on-pi.e2e.js     # the surface mounts on a pi session         (1)
yarn test:e2e:tauri --spec webdriver/specs/ai-flows.e2e.js            # the assistant flows, scripted session
```

The two **model** specs serve their own provider listing from a loopback `node:http` stub in OpenRouter's shape and
re-point the app's default provider at it, so the shipped probe runs for real with no network and no key: the probe is
selected by provider **id**, never by URL. `user-settings.json` is re-read on every `getAISettings()`, which is what
lets a spec's Node half change that answer mid-run.

The **AI flows** ([`support/e2e/ai/flows.mjs`](../support/e2e/ai/flows.mjs)) drive the running app through a
backend-agnostic `AiE2eDriver` and assert both branches of each gate — chat echo and reply, Enter-to-send, the
slash-command palette under a real keyboard, the context and diagnostics drawers, the Project Memory review
gate, and tool approval **Allow** and **Reject** including two gated calls in one turn. A flow that cannot run
for an environmental reason reports **SKIP**, not a pass: the skill-discovery flow does that when the app
binary predates `fs_list_directory`, because the skill source then reads as unreadable.

**Keyboard caveat (WebKitGTK):** a synthetic keystroke run loses a REPEATED character — `…1785799812784`
arrives as `…178579812784`. Any flow whose assertion is the text it typed must avoid adjacent repeats in its
marker; the loss is mid-string, so retyping a tail cannot repair it.

### Real containers, no app

The image itself is verified without the GUI — build it, then run a probe against a real container:

```bash
yarn cli agent-image --engine podman   # or --engine docker; per-engine, not shared
node support/pi-plugins-probe.mjs      # plugin management in a real container
node support/pi-bridge-probe.mjs       # the bridge + data path in a real container
node support/pi-upstream-shape-probe.mjs   # what pi puts on the wire per upstream
```

The **upstream-shape probe** is the only place the gateway's far side is observable: it runs the built image once per
upstream against a stub that records the request body, and fails if a declared upstream did not get its own dialect —
DeepSeek's `thinking` object, GLM's `max_tokens`, OpenRouter's nested `reasoning`, and the `developer` role only where
it belongs. It needs no provider, no key and no network. The first leg deliberately declares nothing, so the
OpenAI-shaped body pi infers from our own gateway is on the record beside the corrected ones.

### Real model, real engine

Run by hand, **never in CI**, on a NON-mock app. All of these need Vite serving the renderer from the worktree under
test, and use its debug binary (or one named by `CONTAINER_DESKTOP_E2E_APP`).

**Keyless, offline, and the one to reach for first** — a real container pair against the LM Studio server on this
machine. It needs no account and no network, and it is the only spec that drives the keyless half: a vault with
nothing stored substituting an empty key, the gateway forwarding to a host-local server through the container's host
alias, and the window the app probed matching what the server actually loaded.

```bash
lms load qwen3-4b-instruct-2507 --context-length 16384 --yes   # tool-capable, and room for the session's own prompt
yarn test:smoke:tauri --spec webdriver/smoke/pi-lmstudio-live.smoke.js
```

A model loaded at less than about 12k cannot answer at all — pi's system prompt plus the tool definitions come to
roughly 9k tokens before the first word — so the spec asserts the loaded length up front rather than letting a turn
fail with the server's own `n_keep >= n_ctx` and reading like an app fault. Overrides: `CD_LIVE_LMSTUDIO_MODEL`,
`CD_LIVE_LMSTUDIO_URL`, `CD_LIVE_WORKSPACE`, `CD_LIVE_ENGINE`.

`pi-plugin-theme-live.smoke.js` runs on the same keyless session and is the only proof that a plugin's OWN component
paints in the app's colours: it seeds an extension into the `cd-agent-plugins` volume that builds pi's `Markdown` from
`getMarkdownTheme()` — the route that reads pi's module-global theme — and asserts the surface frame's truecolor SGR
carries the accent the app is painted in at that moment. It removes the extension again; leaving one behind would
change every later session.

The rest need `OPENROUTER_API_KEY`, because they drive a model's judgement rather than the route to it.

```bash
CD_LIVE_ENGINE=docker \
CONTAINER_DESKTOP_E2E_APP=<repo>/src-tauri/target/debug/container-desktop \
yarn test:smoke:tauri --spec webdriver/smoke/pi-container-live.smoke.js
```

It creates its own throwaway container so the destructive half is proven without touching anything of yours,
and refuses to approve a card aimed at anything else. Overrides: `CD_LIVE_MODEL` (default
`inclusionai/ling-3.0-flash:free`), `CD_LIVE_ENGINE`, `CD_LIVE_VICTIM`, `CD_LIVE_VICTIM_IMAGE`,
`CD_LIVE_WORKSPACE`, `CD_LIVE_APP_VERSION`. The sibling live specs are `pi:extension:live`, `pi:gate:live` and
`pi:data:live`. That last one used to wedge on a WebDriver command at the 180s cap: its wait for a real container
pair, mocha's timeout and the driver's `connectionRetryTimeout` were all the same number, so the spec was killed
mid-command instead of failing with its own reason. `wdio.smoke.conf.js` now gives the harness headroom over the
longest in-spec wait; the container half it covers is also verified by `support/pi-bridge-probe.mjs`.

**Verify the free-model id before a run** (`curl -s https://openrouter.ai/api/v1/models`, filter `:free`) — the
free roster shifts weekly, and the tier is rate-limited (~20/min, 50/day unfunded).

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
| AI UI specs (pi bridge)        | [`webdriver/specs/`](../webdriver/specs) — `extension-ui`, `pi-tool-cards`, `pi-surfaces`, `pi-plugins`, `pi-container-tools`, `pi-model-chip`, `pi-model-reasoning`, `pi-turn-facts`, `pi-session-points`, `assistant-*` |
| Live AI (real model + engine)  | [`webdriver/smoke/pi-container-live.smoke.js`](../webdriver/smoke/pi-container-live.smoke.js) |
| Real-container probes          | [`support/pi-plugins-probe.mjs`](../support/pi-plugins-probe.mjs) · [`support/pi-bridge-probe.mjs`](../support/pi-bridge-probe.mjs) · [`support/pi-upstream-shape-probe.mjs`](../support/pi-upstream-shape-probe.mjs) |
| AI mock fixtures               | [`src/packages/ai-system/src/testing/aiMocks.ts`](../src/packages/ai-system/src/testing/aiMocks.ts) |
