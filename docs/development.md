# Development guide

How to set up, run, verify, and package container-desktop locally. For the *what*
and *why* of the architecture, see the [docs index](README.md); for deep build
internals and conventions, the canonical guide is [`CLAUDE.md`](../CLAUDE.md).

## Prerequisites

| Tool | Version           | Notes                                           |
| ---- | ----------------- | ----------------------------------------------- |
| Node | **24.16.0**       | pinned in [`.nvmrc`](../.nvmrc) — run `nvm use` |
| Yarn | **1.x** (classic) | the package manager; do not use npm             |

The build/dev/release tooling is a TypeScript CLI in [`support/cli/`](../support/cli/) (commander,
run via `tsx` — both installed by `yarn`); there is no Python toolchain.

**Linux one-shot:** `bash support/provision-deps.sh` installs the build toolchain
(auto-detects apt/dnf/pacman). On macOS use [Homebrew](https://brew.sh/); native
Windows is on you (for WSL, follow the Linux path).

## Setup

```bash
nvm use                                   # Node 24.16.0
yarn install --frozen-lockfile            # or: make prepare
```

Installs with the lockfile respected — don't use floating installs.

## Run (hot reload)

```bash
yarn dev          # Tauri (Rust) — the default shell
yarn dev:mock     # …with the deterministic mock backend, no engine required
yarn wails:dev    # the Wails (Go) shell; yarn wails:dev:mcp adds the MCP driver
```

Both shells serve the SAME Vite renderer on :3000 and rebuild on change. Kill either by PID —
never `pkill -f <pattern>` from a one-liner containing that pattern, or it matches its own shell.

## Verify — run all four before claiming done

```bash
yarn check-types   # tsc
yarn lint          # Biome (auto-fixes); yarn lint:check = no writes (CI); yarn format to format only
yarn test:run      # Vitest (hermetic) — see testing.md
yarn build         # the renderer bundle
```

These four are the gate CI enforces
([`CIPipeline.yml`](../.github/workflows/CIPipeline.yml); `check-types`/`lint:check`/`test:run`
also cover the `support/cli/` tooling). For the test model — the headless harness and the `fakeCommand` recording fake
that let the connection layer run without a shell — see [testing.md](testing.md). Also verify
behaviour in the real app: a native webview has no CDP, so drive it over **W3C WebDriver**
(`yarn test:e2e:tauri`). Navigating bare `http://localhost:3000` in a browser won't work — it needs
the shell's host bridge.

## Build & package

```bash
yarn build                       # production bundles (ENVIRONMENT=production implied)
yarn package:linux_x86           # also: mac_arm · win_x86 · linux_arm  (Tauri bundles)
yarn cli release                 # full release: build + bundle with production settings
```

> **Production needs `ENVIRONMENT=production`** (the `build:*` scripts set it). Without
> it the build defaults to development and a packaged app shows a blank window. See
> [`CLAUDE.md`](../CLAUDE.md) → *Build / runtime model* for the single-bundle layout and
> the webview browser baseline.

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

## Remote engines via `.env` (dev)

Seed `podman.remote` / `docker.remote` connections from the multi-stage `.env` chain so `yarn dev`
develops against a remote engine and `yarn test:live` exercises the same hosts — one scheme, both.
Put real values in `.env.development.local` (gitignored); the committed `.env.development` carries the
commented reference. **Dev only:** a packaged build never loads `.env` at runtime, so production
connections still come from `user-settings.json` / the UI.

Each `<ID>` is one remote host (`CONTAINER_DESKTOP_REMOTE_<ID>_*`):

```sh
CONTAINER_DESKTOP_REMOTE_MAC_ENGINE=podman,docker     # podman | docker | podman,docker
CONTAINER_DESKTOP_REMOTE_MAC_SSH_HOST=my-mac          # a Host alias from ~/.ssh/config
CONTAINER_DESKTOP_REMOTE_MAC_SSH_USER=ion             # test:live only (app reads it from ssh config)
CONTAINER_DESKTOP_REMOTE_MAC_SSH_KEY=~/.ssh/id_ed25519  # test:live only
CONTAINER_DESKTOP_REMOTE_MAC_DOCKER_SOCKET=/var/run/docker.sock   # optional relay fallback
```

- The **app** reads the SSH host's user/port/key from `~/.ssh/config` (so `SSH_HOST` must be a Host
  alias). It seeds **readonly** connections regenerated each run (never written to `user-settings.json`),
  so editing a var and reloading adds/removes them; set `AUTOSTART=true` only when it should connect on launch.
- The **socket** is optional — `mode.automatic` auto-detects it over SSH; a `*_SOCKET` value is only a
  fallback. For the live test it is unused (the bounded SSH pre-flight runs `podman info` / `docker info`
  over SSH; `SSH_USER`/`SSH_KEY` are required there because the pre-flight does not read `~/.ssh/config`).
- Run a configured host: `CONTAINER_DESKTOP_TEST_TARGETS=mac yarn test:live` (id = the lowercased `<ID>`).

## See also

- [Architecture overview](architecture/overview.md) — system context & processes
- [Backend](architecture/backend.md) · [Frontend](architecture/frontend.md) ·
  [Connection startup](architecture/connection-startup.md) ·
  [Engine matrix](architecture/engine-matrix.md) ·
  [System tray](architecture/system-tray.md)
- [Architecture notes / principles](architecture/notes.md)
- [Testing](testing.md) — Vitest suites, the headless `Command` harness, CI gate
- [`CLAUDE.md`](../CLAUDE.md) — canonical stack, conventions, working agreements
