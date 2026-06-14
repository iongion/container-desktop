# Project Guide — container-desktop

> **`AGENTS.md` is a symlink to this file.** Edit only this file; both names
> resolve to the same content. Keep it ≤ 200 lines.

## What this is

Cross-platform **Electron desktop app** for managing container engines
(Podman / Docker) — local, remote over SSH, and WSL. One repo, three runtimes:

- **Node / TypeScript** app — Electron main + preload + React renderer
- **Go** SSH/vsock relay — `support/container-desktop-relay/`
- **Python** build tooling — `invoke` tasks (`tasks.py`) + `uv`

## Stack

Electron 42 · React 19 · Vite 8 (rolldown) · TypeScript 6 · Blueprint 6 (UI) ·
Zustand (state) · TanStack Query + Router · @xterm/xterm 6 · monaco · Biome (lint/format).
Node **24.16.0** (`.nvmrc`), **yarn 1.x** (classic). Go 1.25+ (toolchain 1.26.4).
Python ≥ 3.12 via `uv`.

## Layout

- `src/electron-shell/` — `main.ts`, `preload.ts`, `shared.ts`
- `src/web-app/` — React renderer: `App.tsx`, `stores/` (Zustand state),
  `domain/` (TanStack Query client), `screens/`, `components/`, `hooks/`,
  `Native.ts`, `Environment.ts`
- `src/container-client/` — engine API clients/adapters · `src/platform/` ·
  `src/logger/` · `src/utils/` · `src/env/`
- `vite.config.{common,main,preload,renderer}.mjs` · `electron-builder-config.cjs`
  · `support/watch.mjs` (dev launcher) · `tasks.py` / `Makefile`
- **`website-src/`** — Eleventy sources for the public site (container-desktop.com),
  compiled to the **generated `website/`** (never hand-edit `website/`; see Website below).
- **`docs/`** — architecture docs (C4 diagrams) + contributor guides;
  start at `docs/README.md`.
- Path alias **`@/* → src/*`** (e.g. `@/web-app/...`), defined in `tsconfig.json`
  `paths` + explicit `resolve.alias` in the common vite config.

## Commands

Use the project Node first: `nvm use` (24.16.0). Package manager is **yarn**.

- Install: `uv run --locked invoke prepare` or `yarn install --frozen-lockfile`
- **Verify — run all three before claiming done:**
  `yarn check-types` (tsc) · `yarn lint` (Biome) · `yarn build` (main+preload+renderer)
- Dev (hot reload): `yarn dev` · Format: `yarn format`
- Package: `yarn package:linux_x86` (also `mac_arm`/`win_x86`/`linux_arm`);
  full release: `inv release`
- Publish GitHub release assets locally only:
  `uv run --locked invoke publish-release --run-id <actions-run-id>` dry-run,
  then add `--perform`. The Microsoft Store wrapper is optional and can be
  copied into `release/container-desktop-installer.exe` when available.
  `CDPipeline.yml` can also publish after all production targets build; use its
  `replace-release` input to delete/recreate the same version cleanly.
- Relay: `cd support/container-desktop-relay && ./relay-build.sh`; scan `govulncheck ./...`
- Python tooling: `make check` (ruff), `make prepare` (`uv sync --locked --dev --no-install-project`)
- Linux system deps (one-shot): `bash support/provision-deps.sh`

## Build / runtime model — READ BEFORE TOUCHING THE BUILD

- **Source is ESM/TypeScript, but main & preload are bundled to CommonJS (`.cjs`).**
  Electron's API is only reachable via the CJS `require` hook here; ESM output
  makes `import { app } from "electron"` fail to link. **Do not switch main/preload
  to ESM output.** The **renderer stays ESM**.
- `__dirname` is native in the CJS main/preload (the common config only maps it to
  `import.meta.dirname` for ESM output).
- **Preload** builds to `preload-<version>.cjs`; the renderer blocks on
  `window.Preloaded`, exposed via `contextBridge` in `preload.ts`
  (see `Native.ts:waitForPreload`).
- **Production requires `ENVIRONMENT=production`** (e.g.
  `cross-env ENVIRONMENT=production yarn build`): triggers the ncc single-file main
  and loads the packaged renderer over `file://`. Without it the build defaults to
  development and tries the dev-server URL → blank window when packaged.
- Build target is `es2022`; the renderer uses top-level await — keep target ≥ es2022.

## Website (container-desktop.com) — `website/` IS GENERATED, NEVER EDIT IT

- **Never edit anything under `website/` by hand — it is compiled output, wiped and
  rebuilt on every run.** Edit the **`website-src/`** sources instead (Eleventy:
  `_includes/` layouts, `manual/*.md` guides, `_data/` data, `static/` assets), then
  run **`make build-website`** (or `yarn build:website`; live preview `yarn dev:website`).
- The committed `website/` is exactly what GitHub Pages serves
  (`.github/workflows/pages.yml`). Flow: **edit `website-src/` → `make build-website`
  → commit both `website-src/` and `website/` → push**.
- Versions + per-OS download URLs are injected at build time from `package.json`
  (`website-src/_data/`); never hand-edit a version in the output. `tasks.py` reruns
  `build_website` on release so links match the tag.

## Dev launcher (`support/watch.mjs`) & debugging

- Starts the Vite renderer dev server + Electron, rebuilding/respawning on change.
- **GPU flags are gated behind `CONTAINER_DESKTOP_HEADLESS`.** Normal `yarn dev`
  uses safe GPU defaults. Do **not** re-add `--in-process-gpu` /
  `--disable-features=VizDisplayCompositor` to the default path — they caused a GPU
  crash-loop that froze the machine. Use `CONTAINER_DESKTOP_HEADLESS=1` only for CI/headless.
- **Never set `ELECTRON_RUN_AS_NODE`** when launching the app — Electron then runs
  as plain Node, the `electron` API is missing, and startup fails.
- The renderer is exposed over **CDP at `--remote-debugging-port=9222`**; attach a
  Playwright MCP via `--cdp-endpoint http://localhost:9222` to drive the real app.
  Navigating bare `http://localhost:3000` won't work — it needs the preload bridge.
- Kill switch: `pkill -f support/watch.mjs; pkill -f dist/electron`.

## Conventions

- **Biome only** (`biome.json`) — 2-space indent, double quotes, width 120. Don't
  add ESLint/Prettier. `yarn lint` auto-fixes.
- TypeScript strict (`noImplicitAny: false`). `tsconfig.json` uses `paths` (no
  `baseUrl` — removed in TS 6) and `types: ["node"]`.
- **Dependencies are pinned to exact versions** in `package.json` — don't
  reintroduce `^`/`~` ranges casually.
- **Transitive security pins live in `package.json` `resolutions`** (dompurify,
  lodash, fast-uri, @xmldom/xmldom, tmp, brace-expansion, uuid). Fix a transitive
  advisory by adding/adjusting a resolution there, then update and review `yarn.lock`.
- **`npm audit` is unreliable here** — it mis-evaluates yarn `resolutions` (reports
  already-patched versions as vulnerable). Verify by the **installed** version
  (`node -p "require('<pkg>/package.json').version"`), not by `npm audit`.
  `minimatch`/`picomatch` ReDoS advisories are build-tooling-only (not shipped) and
  now have in-range patches — pulled in by refreshing the lockfile entry, not a
  `resolution`. Only their breaking majors are blocked (see dependabot, below).
- **No JS/TS test suite** — verify via type-check + lint + build + manual/CDP smoke.
  Python tests use `pytest` (`support/` only).
- Avoid `console.debug` in render/poll hot paths (floods DevTools, grows memory).
  Use `@/logger` (`createLogger`).

## Working agreements

- Branch off `main`; don't commit directly. Keep commits scoped; no co-author or
  tooling attribution trailers.
- After changes, actually run the verify commands and report real output — never
  claim success unverified.
- Long-running steps (packaging, dev run) → run in the background; don't block.
- `.github/dependabot.yml` groups minor/patch bumps weekly per ecosystem
  (npm / gomod / github-actions); **major bumps are never auto-proposed** (ignored
  globally) — adopt majors deliberately by hand.
- Build/release automation must use lockfile-respecting installs
  (`yarn install --frozen-lockfile`, `uv run --locked` / `uv sync --locked`) and
  pinned tool/action versions. Do not use `@latest` or floating GitHub Actions tags.
