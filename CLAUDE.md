# Project Guide — container-desktop

> **`AGENTS.md` is a symlink to this file.** Edit only this file; both names resolve to the same content. Keep it
> ≤ 200 lines.

## What this is

Cross-platform **desktop app** for managing container engines (Podman, Docker, and Apple Container — the last is
**experimental**, macOS / Apple-silicon only) — local, remote over SSH, and WSL. A **TypeScript** renderer in a native
webview over a **Tauri (Rust)** backend, with an in-app **MCP server** for AI clients. Build/dev/release tooling is a
home-grown CLI (`pnpm cli`, commander + tsx) in `support/cli/`.

## Stack

Tauri 2 (Rust) · React 19 · Vite 8 (rolldown) · TypeScript 7 (native `tsc`) · Blueprint 6 (UI) · Zustand (state) · TanStack Query +
Router · @xterm/xterm 6 · bundled monaco · Biome (lint/format). Node **24.22.3** (`.nvmrc`), **pnpm 12** (`packageManager`).

## Layout

- **`src/packages/*`** — local pnpm **workspaces** (`pnpm-workspace.yaml`, one root lockfile; siblings as `workspace:*`), each `<pkg>/package.json` +
  `<pkg>/src/…`, an acyclic DAG (`dependencies` lists real workspace siblings). Leaves: `utils`, `logger` (the logging
  façade), `i18n` (owns the translation JSONs), `host-contract` (host PORTS: `fs`, path, capabilities, keychain,
  `exec`/`CommandExecutionResult`). Then `container-client` (engine clients/adapters, **owns the domain types in
  `Types.ts`**; there is NO `src/env`), `container-provisioning`, `mcp-server` (the MCP protocol core and tool
  catalogue), `platform`. **No re-exports / barrels** — single origin per type, import from the defining module.
- `src/web-app/` — the **application** (NOT a package): `App.tsx`, `stores/` (Zustand), `domain/` (TanStack Query),
  `screens/`, `components/`, `hooks/`, `Native.ts`, `Environment.ts`. `src/resources/` (assets, `prompts/*.md`), loose
  `*.d.ts` and `src/__tests__/` stay at `src/` root.
- `src/packages/platform/` + `src-tauri/` — runtime ports: shared brokers/services at `platform/src/*`, the Tauri
  webview side in `platform/src/tauri/`. Packaging/branding metadata lives in `support/app-metadata.cjs`.
- **MCP server** — Rust loopback listener `src-tauri/src/mcp/`, webview half `platform/src/tauri/mcpHost.ts`, core
  `src/packages/mcp-server/`; see [`docs/architecture/mcp-server.md`](docs/architecture/mcp-server.md) and the glossary
  in [`CONTEXT.md`](CONTEXT.md).
- `vite.config.{common,renderer}.mjs` · **`support/cli/`** · `Makefile` · **`website-src/`** (Eleventy sources,
  compiled to the **generated `website/`**) · **`docs/`** (C4 architecture + guides; start at `docs/README.md`).
- Path aliases: **`@/<pkg> → src/packages/<pkg>/src`**, **`@/web-app → src/web-app`**, **`@/resources →
  src/resources`**, **`@ → src`** (fallback), **`@/cli/* → support/cli/*`**. Single source in `support/aliases.mjs`
  (`makeAliases`) for vite/vitest; `tsconfig.json` `paths` mirrors it by hand. **Specific `@/<pkg>` entries MUST
  precede the generic `@`** (first-hit matching). Nothing imports by package NAME, so dev needs no build step.

## Commands

Use the project Node first: `nvm use` (24.22.3). Package manager is **pnpm** (`packageManager` in `package.json`; CI installs that exact version).

- Install: `pnpm install --frozen-lockfile` (or `make prepare`)
- **Verify — run all before claiming done:** `pnpm check-types` (tsc — app + `support/cli`) · `pnpm lint` (Biome;
  `pnpm lint:check` = no-write, used in CI) · `pnpm test:run` (Vitest, hermetic) · `pnpm build` (the renderer bundle) ·
  `pnpm lint:tauri` (`src-tauri`: rustfmt check + clippy `-D warnings`; after `ENVIRONMENT=production pnpm build`, whose
  output it embeds). `make test` runs exactly CI's steps, in CI's order.
- Keep no node/@tauri leaks in shared `src/` code.
- Dev (hot reload): `pnpm dev` · Format: `pnpm format`
- Package: `pnpm package:linux_x86` (also `mac_arm`/`win_x86`/`linux_arm`); full release: `pnpm cli release`
- Publish GitHub release assets locally only: `pnpm cli publish-release --run-id <actions-run-id>` dry-run, then add
  `--perform`. The Microsoft Store wrapper is optional (`release/container-desktop-installer.exe`).
  `CDPipeline.Tauri.yml` can also publish after all production targets build; its `replace-release` input
  deletes/recreates the same version cleanly.
- **`pnpm cli <command>`** (source in `support/cli/`): `bundle`, `bump`, `sync-manifests` (alias `version-sync` —
  syncs version + app metadata from `support/app-metadata.cjs`), `release`, `commit-release`, `publish-release`,
  `publish-meta`, `fetch-appx`, `checksums`, `create-icons`, … (`pnpm cli` lists them). Lint/format the tooling with
  `make check` / `make format`.
- Linux system deps (one-shot): `bash support/provision-deps.sh`

## Development workflow — TDD + live app, NOT static-checks-at-the-end (non-negotiable)

- **Test-first (TDD) for logic.** Failing test → watch it fail for the right reason → minimal code to pass. Covers
  pure/near-pure units: hook helpers, `normalizers/`, `comparators`, grouping/flatten, reducers, stores. **Never add
  component tests** for React components/screens; verify those live.
- **Verify every UI change in the running app, as you go.** Drive the mock app over WebDriver (`pnpm test:e2e:tauri
  --spec …`, or a scratch spec) after each change — never batch to the end. The renderer is the source of truth.
- **Static checks close out, they aren't the loop.** Run all four (Commands) only to finish.

## Build / runtime model — READ BEFORE TOUCHING THE BUILD

- **One bundle: the renderer.** `pnpm build` emits `build/<version>/renderer.mjs` (ESM) and nothing else — the native
  backend is compiled by `cargo`, not by vite.
- **The renderer blocks on `window.Preloaded`** (`Native.ts:waitForPreload`), which `platform/tauri/bridge.ts` sets
  LAST, once its window.* globals are up.
- **Production requires `ENVIRONMENT=production`** (`cross-env ENVIRONMENT=production pnpm build`); without it the
  build tries the dev-server URL → blank window when packaged.
- Build target `es2022` (top-level await); browser baseline **`safari 17` + `chrome 120`** (`WEBVIEW_BUILD_TARGET` in
  `vite.config.common.mjs`), the WebKitGTK/WebView2/WKWebView floor.

## Website (iongion.github.io/container-desktop) — `website/` IS GENERATED, NEVER EDIT IT

- Served under `/container-desktop/` (`pathPrefix` in `eleventy.config.mjs`): write root-relative URLs (`/manual/`);
  HtmlBasePlugin prefixes `href`/`src`, `| htmlBaseUrl` covers anything else.
- Edit **`website-src/`** (`_includes/` layouts, `manual/*.md`, `_data/`, `static/`), then **`make build-website`**
  (or `pnpm build:website`; preview `pnpm dev:website`). Commit both `website-src/` and `website/`; GitHub Pages
  serves the committed `website/` (`.github/workflows/pages.yml`).
- Versions + download URLs are injected from `package.json` (`website-src/_data/`); the release flow rebuilds the site.

## Dev launcher & debugging

- **`pnpm dev`** runs Tauri (`pnpm dev:mock` adds the deterministic mock backend), serving the renderer on :3000.
- **There is no CDP** — drive the native webview over **W3C WebDriver**: `pnpm test:e2e:tauri` runs
  `webdriver/wdio.conf.js` (WebdriverIO → `tauri-driver` → `WebKitWebDriver` → the app). Prereqs: `tauri-driver`
  (`~/.cargo/bin`) + `webkitgtk-webdriver`. The harness sets `CONTAINER_DESKTOP_E2E=1` (single-instance OFF, lib.rs)
  and its own `CONTAINER_DESKTOP_USER_DATA_DIR` (own settings, webview storage and secrets, never the OS keychain).
  The debug binary loads `devUrl` :3000 (needs a running vite / `pnpm tauri:serve`); a release binary goes in
  `CONTAINER_DESKTOP_E2E_APP`. **Paint caveat:** WebKitGTK parks its compositor when idle — read the DOM to confirm
  data, use screenshots for paint.
- **On Linux the WebDriver app never reaches your desktop.** Each session runs it on a private headless **sway**
  (`webdriver/support/headlessDisplay.js`, prereq `sway`), no `DISPLAY`, on the first GPU that is not NVIDIA's.
  `CONTAINER_DESKTOP_E2E_HEADLESS=0` shows the window. Keep `displayServerEnabled: false`: WebdriverIO otherwise starts
  its own display server and the worker dies on `write EINVAL`.
- **TWO suites; what a failure may mean is the difference.** `webdriver/specs/*.e2e.js` is the **mock app only** — a
  failure can only mean the app is wrong; always run, **never gated**. `webdriver/smoke/*.smoke.js` is **real
  integration** (real engines, machines): an absent subject must **skip**, not fail and not pass.
- **One entry point per suite.** `pnpm test:e2e:tauri` (mock) · `pnpm test:smoke:tauri` (real, clears
  `CONTAINER_DESKTOP_MOCK`). Select with `--spec <file>`; the scenario travels in the environment
  (`CONTAINER_DESKTOP_MOCK=podman|docker`, `CONTAINER_DESKTOP_MOCK_SWARM=manager|none`,
  `CONTAINER_DESKTOP_MOCK_CONNECTED=none` = boots with NO engine connected). A knob has a DEFAULT and the spec asserts
  each scenario, named in the `describe` title — never a new directory, never a gate, no package.json script per spec.
- **The mock engine is stateless**: a mutation is accepted and the fixtures stay the same, so a mock spec proves a
  change by its result, not by the screen changing.
- **Smoke specs** need a target from `src/__tests__/live/targets.env`: `connection-matrix.smoke.js`, `swarm.smoke.js`
  (against `support/swarm-sandbox.sh up` — NEVER your primary daemon). They drive `window.__cdLiveProbe`, a DEV-gated
  seam that runs the SHIPPED ports inside the webview.
- **A smoke spec's missing prerequisite SKIPS, it never fails.** `webdriver/support/prerequisites.js` checks the real
  app, the engine and whether the target machine is on, and reports SKIP with the fixing command. Never start a VM or
  stand up a sandbox to make a spec run; never gate a mock spec; never let a gate skip something that would have run.
- **NEVER GUESS ROUTES.** Every hash route comes from the source — a screen's `Screen.Route.Path` / its `Navigation.ts`
  constant, a real `#/...` href in the DOM, or an id from the mock snapshot. Grep the route first, then drive it.
- **NEVER `xvfb-run`, and never launch the app by hand to verify the UI.** Drive it over WebDriver.
- **Website capture (screenshots).** `support/cli/media/screenshots.ts` drives a `CaptureDriver` port over WebDriver
  and writes `website-src/static/**`. `pnpm screenshots` also writes the per-engine demo manifests (`demoManifest.ts`
  expands `demoScenario.json` → `/replays/<engine>.json`). Needs `CONTAINER_DESKTOP_MOCK=1 pnpm tauri:serve` for the
  debug binary, or a release binary via `CONTAINER_DESKTOP_E2E_APP`.
- Kill switch: kill the `tauri dev` process by PID. **Footgun:** never run `pkill -f <pattern>` from a one-liner whose
  own text contains `<pattern>` — it kills its own shell (silent exit 144).

## Conventions

- **Biome only** (`biome.json`) — 2-space indent, double quotes, width 120. No ESLint/Prettier. `pnpm lint`
  auto-fixes.
- TypeScript strict (`noImplicitAny: false`). `tsconfig.json` uses `paths` (no `baseUrl`) and `types: ["node"]`.
- **No raw NUL bytes in code.** Write the visible escape `\u0000`, never the raw byte (Git then treats the file as
  binary).
- **Comments:** `//` in TS/JS; JSX `{/* ... */}` and `biome-*` directives as syntax requires. No C-style block, CSS or
  XML comments, and no comments about historical / legacy migrations.
- **Dependencies are pinned to exact versions** in `package.json` — no `^`/`~` ranges.
- **Transitive security pins live in `pnpm-workspace.yaml` `overrides`** (dompurify, lodash, fast-uri, tmp). Fix a
  transitive advisory there, then update and review `pnpm-lock.yaml`. Dependency install scripts run only when
  `allowBuilds` there says so.
- **`npm audit` is unreliable here** (it mis-evaluates the `overrides`). Verify the **installed** version
  (`node -p "require('<pkg>/package.json').version"`). `minimatch`/`picomatch` ReDoS advisories are build-tooling
  only; only their breaking majors are blocked.
- **Tests:** a hermetic **Vitest** suite (`pnpm test:run`) runs the renderer + container-client under plain Node via
  `src/__tests__/setup/` (headless globals + a recording `fakeCommand`); `*.live.test.ts` is reserved for a future
  real-VM suite. `support/cli/**/*.test.ts` run in the same suite. CI gate:
  `.github/workflows/CIPipeline.yml`. Details: [`docs/testing.md`](docs/testing.md).
- **Logging:** `@/logger` (`createLogger`), never raw `console.*` (except the façade sink + the pre-React fallback in
  `index.tsx`). Verbosity is controlled solely by log level.
- **MCP tool descriptions live in `src/resources/prompts/mcp-tool-descriptions.md`**, imported `?raw` — never inline
  model-facing prose in TS.
- **`@/mcp-server/core` stays pure — a review rule, NOT a suite test.** No imports of `@/platform`, `@/i18n`,
  `@/web-app`, `react`, `node:*` or `@tauri`; it reaches engines only through the injected `EngineOps` port. No
  barrels in the package.
- **MCP settings live under `mcp` in `user-settings.json`**, read with `userConfiguration.getKey("mcp")` and
  `normalizeMcpSettings`, never through `getGlobalUserSettings`. `DEFAULT_MCP_PORT` and the protocol versions are
  defined in TS and Rust both: keep them in step.

## UI conventions (renderer · Blueprint)

The user is a hands-on designer and corrects deviations fast — match these up front:

- **Theme tokens — never hardcode colors/spacing.** Use the `--app-*` vars from `src/web-app/themes/tokens.css`
  (`--app-chrome` nav/sidebar · `--app-bg` content · `--app-surface` cards/header · `--app-surface-strong` table
  headers · `--app-border` hairline · `--app-text`/`--app-text-muted` · `--app-accent*`). Match the content rhythm
  (`.AppScreen` 10px pad); a sub-nav rail reuses the `AppSidebar` vertical `ButtonGroup` idiom via `--app-chrome`.
- **Confirmations:** reuse `ConfirmMenu` (inline Yes/No popover), never `Alert`/dialogs.
- **Icons:** must read bright/white in dark theme; use `Icon`'s `color` prop for state colors.
- **Tables:** selection checkbox in the **last** column; trailing columns shrink-to-fit; selection is **always-on**.
- **`ActionsMenu` is context-dual — study it before editing.** **List rows** (`iconOnly`, no `onReload`) = one compact
  `ButtonGroup` (`ResourceItemInlineActionsMenu`, `size="small" variant="minimal"`) with the primary action,
  section-nav and the "…" `ConfirmMenu` inline. **Detail screenheader** (`onReload` set, via
  `screens/<R>/ScreenHeader.tsx`) = the **same `ResourceListActions`** the list header uses: primary action → a
  separate green `actions` **CTA**, section-nav → `navigation`, the "…" menu → `utilityActions`
  (`utilityActionsPlacement="before-reload"`, `large` on `ConfirmMenu`), plus `onReload`. Never hand-roll a divergent
  header row — header and list must match in size/spacing/order/meaning/style/colour.
- **CHANGELOG:** terse one-liners. **Activity log:** response bodies + CLI output only for **failed** calls.

## Working agreements

- Branch off `main`; don't commit directly. Keep commits scoped; no co-author or tooling attribution trailers.
- After changes, actually run the verify commands and report real output — never claim success unverified.
- Long-running steps (packaging, dev run) → run in the background; don't block.
- `.github/dependabot.yml` groups minor/patch bumps weekly per ecosystem (npm / github-actions); **major bumps are
  never auto-proposed** — adopt majors deliberately by hand.
- Build/release automation uses lockfile-respecting installs (`pnpm install --frozen-lockfile`) and pinned
  tool/action versions. No `@latest`, no floating GitHub Actions tags.

## Code Review Standards

After completing any implementation, review the code for: functions longer than 50 lines (not React JSX); logic
duplicated more than twice; any `any` in TypeScript; components with more than 3 props that could be grouped; missing
error handling on async operations. Run /simplify before presenting code to the user.
