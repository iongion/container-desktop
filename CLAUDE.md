# Project Guide — container-desktop

> **`AGENTS.md` is a symlink to this file.** Edit only this file; both names
> resolve to the same content. Keep it ≤ 200 lines.

## What this is

Cross-platform **Electron desktop app** for managing container engines
(Podman, Docker, and Apple Container — the last is **experimental**, macOS /
Apple-silicon only) — local, remote over SSH, and WSL. One repo, three runtimes:

- **Node / TypeScript** app — Electron main + preload + React renderer
- **Go** SSH/vsock relay — `support/container-desktop-relay/`
- **Python** build tooling — `invoke` tasks (`tasks.py`) + `uv`

## Stack

Electron 42 · React 19 · Vite 8 (rolldown) · TypeScript 6 · Blueprint 6 (UI) ·
Zustand (state) · TanStack Query + Router · @xterm/xterm 6 · bundled monaco · Biome (lint/format).
Node **24.16.0** (`.nvmrc`), **yarn 1.x** (classic). Go 1.25+ (toolchain 1.26.4).
Python ≥ 3.12 via `uv`.

## Layout

- `src/electron-shell/` — `main.ts`, `preload.ts`, `shared.ts`
- `src/web-app/` — React renderer: `App.tsx`, `stores/` (Zustand state),
  `domain/` (TanStack Query client), `screens/`, `components/`, `hooks/`,
  `Native.ts`, `Environment.ts`
- `src/container-client/` — engine API clients/adapters · `src/logger/` ·
  `src/utils/` · `src/env/`
- `src/platform/` — Node `Command` primitives: `node-executor.ts` (facade) over
  `exec/` impl modules (process-utils, api-driver, commander, ssh-transport,
  wsl-relay, proxy-request); `node.ts` = `Platform`/`Path`
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
- **Verify — run all four before claiming done:**
  `yarn check-types` (tsc) · `yarn lint` (Biome; `yarn lint:check` = no-write, used in CI) ·
  `yarn test:run` (Vitest, hermetic) · `yarn build` (main+preload+renderer)
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

## Development workflow — TDD + live app, NOT static-checks-at-the-end (non-negotiable)

How you build here, **per change** — not an end-of-task afterthought:

- **Test-first (TDD) for logic.** Failing test → watch it fail for the right reason → minimal
  code to pass. Covers pure/near-pure units: hook helpers, `normalizers/`, `comparators`,
  grouping/flatten, reducers, stores. No production logic without a failing test first — tests
  added after prove nothing. Layout/DOM glue jsdom can't run (virtualizer, ResizeObserver) is
  exempt: verify it live, don't fake it.
- **Verify every UI change in the running app, as you go.** Keep `CONTAINER_DESKTOP_MOCK=1 yarn
  dev` hot-reloading and drive `support/cdp.mjs` (screenshot + `EVAL=` asserts) after each
  change — never batch to the end. The renderer is the source of truth.
- **Static checks close out, they aren't the loop.** `check-types`/`lint`/`test:run`/`build`
  never render the UI; run all four (Commands) only to finish, after the app confirms behavior.

## Build / runtime model — READ BEFORE TOUCHING THE BUILD

- **Source is ESM/TypeScript, but main & preload are bundled to CommonJS (`.cjs`).**
  Electron's API is only reachable via the CJS `require` hook here; ESM output
  makes `import { app } from "electron"` fail to link. **Do not switch main/preload
  to ESM output.** The **renderer stays ESM**.
- `__dirname` is native in the CJS main/preload (the common config only maps it to
  `import.meta.dirname` for ESM output).
- **Preload** builds to `build/<version>/preload.cjs`; the renderer blocks on
  `window.Preloaded`, exposed via `contextBridge` in `preload.ts`
  (see `Native.ts:waitForPreload`).
- **Production requires `ENVIRONMENT=production`** (e.g.
  `cross-env ENVIRONMENT=production yarn build`): emits the single-file
  `build/<version>/{main.cjs,preload.cjs,renderer.mjs}` layout and loads the
  packaged renderer over `file://`. `ssh2` is bundled by rolldown `ssr.noExternal`,
  not ncc. Without production env the build defaults to development and tries the
  dev-server URL → blank window when packaged.
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
- The renderer is exposed over **CDP on an auto-selected port**: `yarn dev` prefers
  `9222` but **falls back to a free port if it's taken** (e.g. a podman rootless
  port-forward squatting 9222) and writes the live endpoint to
  `$TMPDIR/container-desktop-cdp.json` (also logged as `CDP endpoint: …`). **Don't assume
  9222** — read that file. Force a port with `CONTAINER_DESKTOP_REMOTE_DEBUGGING_PORT`.
  Bare `http://localhost:3000` won't work — it needs the preload bridge.
- **`support/cdp.mjs`** is the headless CDP driver for verification/screenshots — it
  **attaches** to the already-running dev app (never launches/closes it), settles through
  reloads, prints a structured snapshot (theme/engine/route + per-connection counts &
  runtime from `resource:get-snapshot`), and writes a PNG:
  `node support/cdp.mjs /tmp/app.png '#/screens/containers'`. Env: `RELOAD=1` re-runs the
  renderer bootstrap (initialize → connectAll); `EVAL='<expr>'` runs an expression in the
  page and prints its JSON result (use `EVAL="$(cat file.js)"` for multi-line — incl. async
  IIFEs); it **auto-discovers the port** from that handshake file, and `CDP_URL` overrides
  it. Multi-engine dev: `CONTAINER_DESKTOP_MOCK=1 yarn dev`
  boots Podman+Docker mocks, then drive with this. (See [memory: Verify Electron app via CDP].)
- Kill switch: `pkill -f support/watch.mjs; pkill -f dist/electron`. **Footgun:** never
  run `pkill -f <pattern>` from a one-liner whose own command text contains `<pattern>` —
  it matches and kills its own shell (silent exit 144). Kill by numeric PID instead.

## Conventions

- **Biome only** (`biome.json`) — 2-space indent, double quotes, width 120. Don't
  add ESLint/Prettier. `yarn lint` auto-fixes.
- TypeScript strict (`noImplicitAny: false`). `tsconfig.json` uses `paths` (no
  `baseUrl` — removed in TS 6) and `types: ["node"]`.
- **Dependencies are pinned to exact versions** in `package.json` — don't
  reintroduce `^`/`~` ranges casually.
- **Transitive security pins live in `package.json` `resolutions`** (dompurify,
  lodash, fast-uri, @xmldom/xmldom, tmp). Fix a transitive
  advisory by adding/adjusting a resolution there, then update and review `yarn.lock`.
- **`npm audit` is unreliable here** — it mis-evaluates yarn `resolutions` (reports
  already-patched versions as vulnerable). Verify by the **installed** version
  (`node -p "require('<pkg>/package.json').version"`), not by `npm audit`.
  `minimatch`/`picomatch` ReDoS advisories are build-tooling-only (not shipped) and
  now have in-range patches — pulled in by refreshing the lockfile entry, not a
  `resolution`. Only their breaking majors are blocked (see dependabot, below).
- **Tests:** a hermetic **Vitest** suite (`yarn test:run`) runs the renderer +
  container-client under plain Node via `src/__tests__/setup/` (headless globals + a recording
  `fakeCommand`); `*.live.test.ts` + `installRealCommand()` are reserved for a future real-VM
  suite (no separate config yet). Go relay `go test ./...`; Python `pytest` (`support/`). CI
  gate: `.github/workflows/CIPipeline.yml`. Details: [`docs/testing.md`](docs/testing.md).
- **UI changes:** verify live in the running app, not off static checks — see Development workflow.
- **Logging:** use `@/logger` (`createLogger`), never raw `console.*` (except the façade
  sink + the pre-React fallback in `index.tsx`). Verbosity is controlled solely by log level.

## UI conventions (renderer · Blueprint)

The user is a hands-on designer and corrects deviations fast — match these up front:

- **Theme tokens — never hardcode colors/spacing.** Read the `--app-*` vars from
  `src/web-app/themes/tokens.css` (`--app-chrome` receding nav/sidebar · `--app-bg`
  content · `--app-surface` cards/header · `--app-surface-strong` table headers ·
  `--app-border` hairline · `--app-text`/`--app-text-muted` · `--app-accent*`) so UI
  tracks every engine×mode. A hardcoded `rgba()`/hex (or an invented var) looks foreign.
  Match the app's content rhythm (`.AppScreen` 10px pad; generous panel padding); a
  sub-nav rail reuses the `AppSidebar` vertical `ButtonGroup` idiom and recedes via
  `--app-chrome`.
- **Confirmations:** reuse `ConfirmMenu` (inline Yes/No popover), never `Alert`/dialogs.
- **Icons:** must read bright/white in dark theme (muted `#abb3bf` looks disabled); use
  `Icon`'s `color` prop for state colors.
- **Tables:** selection checkbox in the **last** column (first breaks the grouped/tree
  view); trailing columns shrink-to-fit. Selection is **always-on** (action bar shows
  when ≥1 selected).
- **CHANGELOG:** terse one-liners. **Activity log:** response bodies + CLI output only
  for **failed** calls.

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
