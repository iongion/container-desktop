# Project Guide — container-desktop

> **`AGENTS.md` is a symlink to this file.** Edit only this file; both names
> resolve to the same content. Keep it ≤ 200 lines.

## What this is

Cross-platform **desktop app** for managing container engines
(Podman, Docker, and Apple Container — the last is **experimental**, macOS /
Apple-silicon only) — local, remote over SSH, and WSL. A **TypeScript** renderer over a native backend:

- **App** — React renderer in a native webview, over a Tauri (Rust) or Wails (Go) backend
- **Build/dev/release tooling** — a home-grown CLI (`yarn cli`, commander + tsx) in `support/cli/`

## Stack

Tauri 2 (Rust) · Wails 3 (Go) · React 19 · Vite 8 (rolldown) · TypeScript 6 · Blueprint 6 (UI) ·
Zustand (state) · TanStack Query + Router · @xterm/xterm 6 · bundled monaco · Biome (lint/format).
Node **24.16.0** (`.nvmrc`), **yarn 1.x** (classic). Build/dev/release tooling is a home-grown
TypeScript CLI (commander) run via **tsx**, in `support/cli/` — no Python.

## Layout

- **`src/packages/*`** — the library packages: local yarn **workspaces** (root-only lockfile + hoisting),
  each a proper npm layout (`<pkg>/package.json` + `<pkg>/src/…`). Acyclic DAG (a package's `package.json`
  `dependencies` lists its real workspace siblings). Leaves: `utils`, `logger` (the logging façade — was
  `platform/logger`), `i18n` (owns the translation JSONs), `host-contract` (AI-free host PORTS: `fs`, path,
  capabilities, `exec`/`CommandExecutionResult`), `template` (prompt/markdown templates). Then `ai-system` (fully decoupled — the first
  publish target), `container-client` (engine clients/adapters + **owns the domain types in `Types.ts`** — the
  old `src/env/Types.ts` god-file was dissolved; there is NO `src/env`), `container-provisioning`, `platform`.
  **No re-exports / barrels** — single origin per type, import from the defining module.
- `src/web-app/` — the **application** (NOT a package): React renderer — `App.tsx`, `stores/` (Zustand),
  `domain/` (TanStack Query), `screens/`, `components/`, `hooks/`, `Native.ts`, `Environment.ts`. Consumes the
  packages via `@/…`. `src/resources/` (assets) + loose `*.d.ts` + `src/__tests__/` also stay at `src/` root.
- `src/packages/platform/` + `src-tauri/` + `src-wails/` — runtime ports: shared brokers/services live at
  `platform/src/*`; `tauri/` (Rust backend) and `wails/` (Go backend) align host, command, exec, buses, tray,
  runtime, AI. Packaging/branding metadata is centralized in `support/app-metadata.cjs`.
- `src/packages/ai-system/` — local-first AI assistant (hexagonal: core/host/runtimes/ui): local + cloud providers, permission-gated **typed container tools → generative-UI cards**; see [`docs/architecture/ai-subsystem.md`](docs/architecture/ai-subsystem.md).
- `vite.config.{common,renderer}.mjs` · **`support/cli/`** (the `yarn cli` build/dev/release
  tool, commander + tsx) · `Makefile`
- **`website-src/`** — Eleventy sources for the public site (container-desktop.com),
  compiled to the **generated `website/`** (never hand-edit `website/`; see Website below).
- **`docs/`** — architecture docs (C4 diagrams) + contributor guides;
  start at `docs/README.md`.
- Path aliases: each package is **`@/<pkg> → src/packages/<pkg>/src`**; the app/assets keep **`@/web-app → src/web-app`**,
  **`@/resources → src/resources`**, and **`@ → src`** (fallback); **`@/cli/* → support/cli/*`** for the tooling.
  The vite/vitest map is a **single source in `support/aliases.mjs`** (`makeAliases`), imported by
  `vite.config.common.mjs` + the vitest configs; `tsconfig.json` `paths` mirrors it by hand. **Specific `@/<pkg>`
  entries MUST precede the generic `@` → src** (first-hit matching). Nothing imports by package NAME
  (`@container-desktop/*`), so dev resolves alias→TS-source with **no build step** (hot reload intact).

## Commands

Use the project Node first: `nvm use` (24.16.0). Package manager is **yarn**.

- Install: `yarn install --frozen-lockfile` (or `make prepare`)
- **Verify — run all before claiming done:**
  `yarn check-types` (tsc — app + `support/cli`) · `yarn lint` (Biome; `yarn lint:check` = no-write, used in CI) ·
  `yarn test:run` (Vitest, hermetic) · `yarn build` (the renderer bundle)
- Keep no node/@tauri/@wailsio leaks in shared `src/` code.
- Dev (hot reload): `yarn dev` · Format: `yarn format`
- Package: `yarn package:linux_x86` (also `mac_arm`/`win_x86`/`linux_arm`);
  full release: `yarn cli release`
- Publish GitHub release assets locally only:
  `yarn cli publish-release --run-id <actions-run-id>` dry-run,
  then add `--perform`. The Microsoft Store wrapper is optional and can be
  copied into `release/container-desktop-installer.exe` when available.
  `CDPipeline.Tauri.yml` (the default release pipeline; `CDPipeline.Wails.yml` is the
  alternate) can also publish after all production
  targets build; use its `replace-release` input to delete/recreate the same version cleanly.
- **Build/dev/release CLI:** `yarn cli <command>` (commander + tsx; source in `support/cli/`) — the
  home-grown replacement for the old Python `invoke` tasks: `bundle`, `bump`, `sync-manifests`
  (alias `version-sync` — syncs version + shared app metadata from `support/app-metadata.cjs` into the
  derived manifests), `release`, `commit-release`, `publish-release`, `publish-meta`, `fetch-appx`, `checksums`,
  `create-icons`, … (run `yarn cli` to list them). Lint/format the tooling with `make check` /
  `make format` (Biome).
- Linux system deps (one-shot): `bash support/provision-deps.sh`

## Development workflow — TDD + live app, NOT static-checks-at-the-end (non-negotiable)

How you build here, **per change** — not an end-of-task afterthought:

- **Test-first (TDD) for logic.** Failing test → watch it fail for the right reason → minimal
  code to pass. Covers pure/near-pure units: hook helpers, `normalizers/`, `comparators`,
  grouping/flatten, reducers, stores. No production logic without a failing test first — tests
  added after prove nothing. **Never add component tests** for React components/screens/presentational
  UI; verify those live, don't fake them in jsdom.
- **Verify every UI change in the running app, as you go.** Keep `yarn dev:mock` hot-reloading and
  drive it over WebDriver (`yarn test:e2e:tauri --spec …`, or a scratch spec) after each change —
  never batch to the end. The renderer is the source of truth.
- **Static checks close out, they aren't the loop.** `check-types`/`lint`/`test:run`/`build`
  never render the UI; run all four (Commands) only to finish, after the app confirms behavior.

## Build / runtime model — READ BEFORE TOUCHING THE BUILD

- **One bundle: the renderer.** `yarn build` emits `build/<version>/renderer.mjs` (ESM) and nothing
  else — the native backend is compiled by `cargo` (Tauri) or `go` (Wails), not by vite.
- **The renderer blocks on `window.Preloaded`** (`Native.ts:waitForPreload`), which each shell's host
  bridge sets LAST, once its window.* globals are up — `platform/{tauri,wails}/bridge.ts`.
- **Production requires `ENVIRONMENT=production`** (e.g.
  `cross-env ENVIRONMENT=production yarn build`) and loads the packaged renderer from the native
  side. Without production env the build defaults to development and tries the dev-server URL →
  blank window when packaged.
- Build target is `es2022` (the renderer uses top-level await — keep it ≥ es2022); the browser
  baseline is **`safari 17` + `chrome 120`** (`WEBVIEW_BUILD_TARGET` in `vite.config.common.mjs`),
  the WebKitGTK/WebView2/WKWebView floor.

## Website (container-desktop.com) — `website/` IS GENERATED, NEVER EDIT IT

- **Never edit anything under `website/` by hand — it is compiled output, wiped and
  rebuilt on every run.** Edit the **`website-src/`** sources instead (Eleventy:
  `_includes/` layouts, `manual/*.md` guides, `_data/` data, `static/` assets), then
  run **`make build-website`** (or `yarn build:website`; live preview `yarn dev:website`).
- The committed `website/` is exactly what GitHub Pages serves
  (`.github/workflows/pages.yml`). Flow: **edit `website-src/` → `make build-website`
  → commit both `website-src/` and `website/` → push**.
- Versions + per-OS download URLs are injected at build time from `package.json`
  (`website-src/_data/`); never hand-edit a version in the output. The release flow
  (`make release` → `make build-assets`) rebuilds the website so links match the tag.

## Dev launcher & debugging

- **`yarn dev`** runs Tauri (`yarn dev:mock` adds the deterministic mock backend); `yarn wails:dev`
  / `yarn wails:dev:mcp` run the Go shell. Both serve the SAME Vite renderer on :3000.
- **There is no CDP** — the renderer runs in a native webview, not Chromium. Drive it over **W3C
  WebDriver**: `yarn test:e2e:tauri` runs `webdriver/wdio.conf.js` (WebdriverIO → `tauri-driver` →
  `WebKitWebDriver` → the app). Prereqs: `tauri-driver` (`~/.cargo/bin`) + `webkitgtk-webdriver`
  (`/usr/bin/WebKitWebDriver`). The harness sets `CONTAINER_DESKTOP_E2E=1`, which gates
  single-instance OFF (lib.rs) so it runs standalone next to your dev app. Specs use
  `browser.execute`/`saveScreenshot`. **Caveat:** the debug binary loads `devUrl` :3000 (needs a
  running vite / `yarn tauri:serve`); point at a self-contained release binary via
  `CONTAINER_DESKTOP_E2E_APP`. **Paint caveat:** WebKitGTK parks its compositor when idle, so a
  WebDriver screenshot can force a paint the live view hadn't done — read the DOM to confirm data,
  use eyes/screenshots for paint.
- **TWO suites, and what a failure is allowed to mean is the difference.** `webdriver/specs/*.e2e.js` is the
  **mock app only** — nothing outside the app is involved, so a failure can only mean the app is wrong; these
  always run and are **never gated on anything**. `webdriver/smoke/*.smoke.js` is **real integration** (real
  engines, machines, account, model): their subject IS the integration, so an absent subject must **skip**, not
  fail (that would blame the app) and not pass (that would claim coverage nobody has).
- **One entry point per suite.** `yarn test:e2e:tauri` (mock) · `yarn test:smoke:tauri` (real, clears
  `CONTAINER_DESKTOP_MOCK`). Select with `--spec <file>`; let the scenario travel in the environment
  (`CONTAINER_DESKTOP_MOCK=podman|docker`, `CONTAINER_DESKTOP_MOCK_SWARM=manager|none`). Do NOT add a
  package.json script per spec/scenario.
- **Smoke specs** need a configured target from `src/__tests__/live/targets.env`:
  `connection-matrix.smoke.js` (the connectivity matrix), `swarm.smoke.js` (real Docker Swarm, against
  `support/swarm-sandbox.sh up` — NEVER your primary daemon). They drive `window.__cdLiveProbe` /
  `window.__cdExecutionMatrixProbe`, DEV-gated seams that run the SHIPPED ports inside the webview, so one
  probe covers both backends.
- **A smoke spec's missing prerequisite SKIPS, it never fails.** It asks
  `webdriver/support/prerequisites.js` first — real app, engine, agent image for that engine,
  `OPENROUTER_API_KEY`, LM Studio's loaded context, and whether the target machine is even powered on — and
  reports SKIP with the fixing command. Never start a VM, load a model, stand up a sandbox or build an image
  to make a spec run; never gate a mock spec (nothing is absent, so a gate could only hide a defect); and
  never let a gate skip something that would have run — that reads as coverage.
- **The Wails shell has its own driver**, `support/wails-mcp.mjs` (MCP + X11 grab).
- **NEVER GUESS ROUTES.** Every hash route you navigate to (or assert on) MUST come from the source —
  a screen's `Screen.Route.Path` / its `Navigation.ts` constant (e.g. `BUILD_ROUTE`), a real `#/...`
  href in the rendered DOM, or an id returned by the mock snapshot — never an invented path or a
  fabricated entity id (`.../mock-c-1/inspect` is a guess, not a route). Guessing sends you to a dead
  route, the screen never mounts, and you misread that as a broken feature. Grep the route first, then drive it.
- **NEVER `xvfb-run` or spawn a second app instance to verify the UI.** Drive the running dev app
  over WebDriver (above); that is the required verification path.
- **Website capture (screenshots) runs on either shell.** `support/cli/media/screenshots.ts` drives a
  `CaptureDriver` port with two adapters — WebdriverIO/WebDriver (Tauri, reusing the `test:e2e:tauri`
  stack) and MCP + X11 grab (Wails). Pick via **`CONTAINER_DESKTOP_CAPTURE_BACKEND=tauri|wails`**
  (**default `tauri`**) or `--backend`. Both backends write the same published
  `website-src/static/**` images — Tauri is the default producer, Wails the comparison. The website **demo** is a
  screenshot slideshow: `yarn screenshots` also writes the per-engine demo manifests
  (`demoManifest.ts` expands `demoScenario.json` → `/replays/<engine>.json`, paged by `demo-replay.js`).
  Tauri needs `CONTAINER_DESKTOP_MOCK=1 yarn tauri:serve` for the debug binary, or a release binary via
  `CONTAINER_DESKTOP_E2E_APP`.
- **AI e2e flows (`support/e2e/ai/flows.mjs`) share ONE app session — isolate per flow or it's cross-flow
  state, not an app bug.** An assistant turn from a prior flow may still be STREAMING when the next flow submits;
  the interactive engine treats a submit into an active session as STEERING (it interrupts that turn), so a
  gated-tool message can land in the previous chat and its approval card auto-resolves. Assistant flows must
  `newAssistantChat()` (wait for idle — no `.AIComposerStop` — → New chat → wait transcript empty) before
  submitting. A flow that passes in isolation but fails in the full suite is almost always this.
- Kill switch: kill the `tauri dev` / `wails3 dev` process by PID. **Footgun:** never
  run `pkill -f <pattern>` from a one-liner whose own command text contains `<pattern>` —
  it matches and kills its own shell (silent exit 144). Kill by numeric PID instead.

## Conventions

- **Biome only** (`biome.json`) — 2-space indent, double quotes, width 120. Don't
  add ESLint/Prettier. `yarn lint` auto-fixes.
- TypeScript strict (`noImplicitAny: false`). `tsconfig.json` uses `paths` (no
  `baseUrl` — removed in TS 6) and `types: ["node"]`.
- **No raw NUL bytes in code.** Never insert literal/invisible NUL bytes into source
  files. If code needs a NUL separator, write the visible escape sequence `\u0000`;
  do not type, paste, or copy the raw byte itself into a string, because it makes
  Git/editor tooling treat the file as binary.
- **Comments:** use `//` in TypeScript/JavaScript source; keep JSX `{/* ... */}` and
  `biome-*` directive comments as required by tooling/syntax. Do not add C-style
  block comments, CSS comments, XML comments, or comments that explain historical /
  legacy migrations; delete stale history instead of preserving it.
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
  suite (no separate config yet). The `support/cli/` tooling has its own Vitest specs
  (`support/cli/**/*.test.ts`, included in `yarn test:run`). CI
  gate: `.github/workflows/CIPipeline.yml`. Details: [`docs/testing.md`](docs/testing.md).
- **UI changes:** verify live in the running app, not off static checks — see Development workflow.
- **Logging:** use `@/logger` (`createLogger`), never raw `console.*` (except the façade
  sink + the pre-React fallback in `index.tsx`). Verbosity is controlled solely by log level.
- **AI prompts & markdown live in templates, NEVER inlined.** Every model-facing prompt (system/agent,
  generate, per-screen focus, …) AND any static markdown/prose block (incl. demo/example transcripts) is a
  `.md` file under `src/resources/prompts/`, rendered via `renderPrompt` (nunjucks **browser** build
  → node-free) or imported `?raw`. NEVER inline prompt/markdown prose in TS/TSX — add a `.md` there and import it.
- **AI dependency direction — a review rule, NOT a suite test.** `@/ai-system/core/` stays dependency-free: no
  imports of `@/platform`, `@/i18n`, `@/web-app`/`@/components`, the AI SDK (`ai` / `@ai-sdk/*`), `react`,
  `node:*`, `@tauri`/`@wailsio`, or sibling `@/ai-system/{adapters,host,ui}`. The package's layers are `core/`
  (pure protocol + policy) → `adapters/` (impure infra) → `host/`, which composes `core/` + `adapters/` only.
  The agent engine is **not** in this package: the assistant runs on the pi bridge (`@/pi-bridge` protocol +
  `@/pi-agent-host` in the container), injected into `createAISystem`, so no agent library enters `core`'s
  graph. No barrels / `index.ts` aggregators / pass-through re-exports anywhere in `@/ai-system` — import from
  the defining module. This is common sense; hold the line in review, don't encode it as a Vitest test.
- **Shell port-module parity is a review rule, not a test.** Keep the Tauri / Wails port modules in
  `src/platform/<shell>/` aligned (a capability added to one shell usually needs its peers) — verify it in review;
  don't assert directory-listing parity in a Vitest test.

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
- **`ActionsMenu` is context-dual — study it before editing.** Each `screens/<R>/ActionsMenu.tsx`
  is reused two ways and MUST render differently by context: **list rows** (`iconOnly`, no `onReload`)
  = one compact `ButtonGroup` (`ResourceItemInlineActionsMenu`, `size="small" variant="minimal"`) with
  the primary action, section-nav and the "…" `ConfirmMenu` inline together — the list-row look, preserve
  it. **Detail screenheader** (`onReload` set, via `screens/<R>/ScreenHeader.tsx`) = render through the
  **same `ResourceListActions`** the list header uses: primary action → a separate `actions` **CTA**
  (green, standalone, not inlined), section-nav → `navigation`, the "…" menu → `utilityActions`
  (`utilityActionsPlacement="before-reload"`, pass `large` to `ConfirmMenu`), plus `onReload`. Same
  component ⇒ identical **8px CTA gap · default-size utility group · trailing minimal
  `ResourceListActionsReload`** by construction. Never hand-roll a divergent header row — header and
  list must match in size/spacing/order/meaning/style/colour.
- **CHANGELOG:** terse one-liners. **Activity log:** response bodies + CLI output only
  for **failed** calls.

## Working agreements

- Branch off `main`; don't commit directly. Keep commits scoped; no co-author or
  tooling attribution trailers.
- After changes, actually run the verify commands and report real output — never
  claim success unverified.
- Long-running steps (packaging, dev run) → run in the background; don't block.
- `.github/dependabot.yml` groups minor/patch bumps weekly per ecosystem
  (npm / github-actions); **major bumps are never auto-proposed** (ignored
  globally) — adopt majors deliberately by hand.
- Build/release automation must use lockfile-respecting installs
  (`yarn install --frozen-lockfile`) and pinned tool/action versions. Do not use
  `@latest` or floating GitHub Actions tags.

## Code Review Standards

After completing any implementation, review the code for:

- Functions longer than 50 lines (likely doing too much) that are not react JSX
- Logic duplicated more than twice (extract to utility)
- Any `any` type usage in TypeScript (replace with real types)
- Components with more than 3 props that could be grouped into an object
- Missing error handling on async operations

Run /simplify before presenting code to the user.
