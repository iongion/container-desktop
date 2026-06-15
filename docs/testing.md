# Testing

The verification gate is **type-check · lint · unit tests · production build**, plus the Go
relay and Python suites — all enforced on every PR and push to `main` by
[`.github/workflows/CIPipeline.yml`](../.github/workflows/CIPipeline.yml). That is the **CI**
pipeline; `CDPipeline.yml` is the separate **release/publish** pipeline and runs no checks.

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

### Live suite (reserved)

`*.live.test.ts` files are excluded from the hermetic run and are meant to drive a **real**
engine/VM; [`installRealCommand()`](../src/__tests__/setup/headless.ts) wires the real Node
executor for them. There is no separate live config or script yet — the convention is reserved.

## Go relay

```bash
cd support/container-desktop-relay && go test ./...
```

The Windows SSH paths are `//go:build windows`, so they only compile under `GOOS=windows` — CI
runs `go test` on **both** ubuntu and windows for that reason.

## Python tooling

```bash
uv run --locked ruff check tasks.py ./support ./tests
uv run --locked pytest
```

## CI jobs

[`CIPipeline.yml`](../.github/workflows/CIPipeline.yml) runs three jobs:

| Job         | Does                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| **app**     | `yarn check-types` · `yarn lint:check` · `yarn test:run` · `ENVIRONMENT=production yarn build` |
| **relay**   | `go test ./...` on ubuntu **and** windows                                                      |
| **tooling** | `ruff check` · `pytest` (via `uv`)                                                             |

## Source map

| Piece                          | Path                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| CI gate                        | [`.github/workflows/CIPipeline.yml`](../.github/workflows/CIPipeline.yml)     |
| Headless globals / live opt-in | [`src/__tests__/setup/headless.ts`](../src/__tests__/setup/headless.ts)       |
| Recording `Command` fake       | [`src/__tests__/setup/fakeCommand.ts`](../src/__tests__/setup/fakeCommand.ts) |
| Vitest config                  | [`vitest.config.mts`](../vitest.config.mts)                                   |
