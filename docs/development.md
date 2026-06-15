# Development guide

How to set up, run, verify, and package container-desktop locally. For the *what*
and *why* of the architecture, see the [docs index](README.md); for deep build
internals and conventions, the canonical guide is [`CLAUDE.md`](../CLAUDE.md).

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node | **24.16.0** | pinned in [`.nvmrc`](../.nvmrc) — run `nvm use` |
| Yarn | **1.x** (classic) | the package manager; do not use npm |
| Python | ≥ **3.12** via [`uv`](https://docs.astral.sh/uv/) | runs the `invoke` build tasks |
| Go | **1.25+** | only to build the relay (`support/container-desktop-relay/`) |

**Linux one-shot:** `bash support/provision-deps.sh` installs the build toolchain
(auto-detects apt/dnf/pacman). On macOS use [Homebrew](https://brew.sh/); native
Windows is on you (for WSL, follow the Linux path).

## Setup

```bash
nvm use                                   # Node 24.16.0
uv run --locked invoke prepare            # or: yarn install --frozen-lockfile
```

Both install with the lockfile respected — don't use floating installs.

## Run (hot reload)

```bash
yarn dev          # cross-env ENVIRONMENT=development node support/watch.mjs
```

`support/watch.mjs` starts the Vite renderer dev server and Electron, rebuilding
and respawning on change. Kill switch:

```bash
pkill -f support/watch.mjs; pkill -f dist/electron
```

> Don't set `ELECTRON_RUN_AS_NODE` (Electron then runs as plain Node and the
> `electron` API vanishes). GPU flags are gated behind `CONTAINER_DESKTOP_HEADLESS`
> — leave the default path alone; it avoided a GPU crash-loop.

## Verify — run all four before claiming done

```bash
yarn check-types   # tsc
yarn lint          # Biome (auto-fixes); yarn lint:check = no writes (CI); yarn format to format only
yarn test:run      # Vitest (hermetic) — see testing.md
yarn build         # main + preload + renderer
```

These four are the gate CI enforces
([`CIPipeline.yml`](../.github/workflows/CIPipeline.yml), which also runs the Go relay and
Python suites). For the test model — the headless harness and the `fakeCommand` recording fake
that let the connection layer run without Electron — see [testing.md](testing.md). Also verify
behaviour over CDP: the renderer is exposed at `--remote-debugging-port=9222`, so you can
attach a Playwright client via `--cdp-endpoint http://localhost:9222` to drive the real app
(navigating bare `http://localhost:3000` won't work — it needs the preload bridge).

## Build & package

```bash
yarn build                       # production bundles (ENVIRONMENT=production implied)
yarn package:linux_x86           # also: mac_arm · win_x86 · linux_arm  (electron-builder)
inv release                      # full release: build + bundle with production settings
```

> **Production needs `ENVIRONMENT=production`** (the `build:*` scripts set it). Without
> it the build defaults to development and a packaged app shows a blank window. See
> [`CLAUDE.md`](../CLAUDE.md) → *Build / runtime model* for why main/preload are CJS
> while the renderer stays ESM.

**Relay:** `cd support/container-desktop-relay && ./relay-build.sh`
(scan with `govulncheck ./...`).

**Website:** `yarn build:website` (preview `yarn dev:website`). Never hand-edit the
generated `website/` — edit `website-src/` (see `CLAUDE.md` → *Website*).

## Working with the engine API directly

Handy while debugging the connection layer (see
[architecture/connection-startup.md](architecture/connection-startup.md)):

```bash
# Start the Podman API on a unix socket (what the app does for native Podman)
podman system service --time=0 unix:///tmp/podman.sock --log-level=debug
# Probe it
curl --unix-socket /tmp/podman.sock http://d/v3.0.0/libpod/info

# HTTP API — DEVELOPMENT ONLY, insecure
podman system service tcp:localhost:8081 --time=0 --log-level=debug --cors="*"
curl -X GET http://localhost:8081/v3.0.0/libpod/info
```

To reach a Podman-machine socket over SSH, tunnel it to a local unix socket:

```bash
ssh -nNT -L /tmp/podman.sock:/run/user/1000/podman/podman.sock \
  -i ~/.ssh/podman-machine-default ssh://core@localhost:[PORT]
export DOCKER_HOST='unix:///tmp/podman.sock'
```

## See also

- [Architecture overview](architecture/overview.md) — system context & processes
- [Backend](architecture/backend.md) · [Frontend](architecture/frontend.md) ·
  [Connection startup](architecture/connection-startup.md) ·
  [Engine matrix](architecture/engine-matrix.md)
- [Architecture notes / principles](architecture/notes.md)
- [Testing](testing.md) — Vitest suites, the headless `Command` harness, CI gate
- [`CLAUDE.md`](../CLAUDE.md) — canonical stack, conventions, working agreements
