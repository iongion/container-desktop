# Implementation Plan — AI Subsystem Test Coverage

**UI (mock · scale · both-branches) + Live LLM/Agent/Execution (OpenRouter free · multi-inference)**

Consolidates: `.scratch/ai-live-testing/{feature-inventory,ui-surfaces,coverage-and-gaps}.md`, direct reads of
`RunScreen.tsx` + `src/resources/prompts/*`, and OpenRouter free-model research (2026-07). Grounded on source, not
the docs.

---

## 0. Goal & the core problem

The app grew a full **agentic AI subsystem** (`@/ai-system`) on top of the old streaming chatbot: **Assistant**
(chat + typed tools + generative-UI cards), **Runs** (multi-agent DAG with plan approval), **Workers** (agent
library with a **"Runs on"** container-execution target). Testing today has two holes:

1. **No automated test ever makes a real model call.** Every chat/goal/tool test drives a *scripted* OMA adapter
   or a canned SSE stub (`testing/omaMocks.ts`, `omaAdapter.test.ts`). The execution *transport* has a real live
   arm (`runs-on.live.test.ts`) but its Team Run executes **no model** (`stubTransport` rejects model calls).
2. **Almost no AI UI is automatically verified.** The only AI UI automation is 3 happy-path flows in
   `support/e2e/ai/flows.mjs` (chat echo, run plan→approve→synthesis, worker create/list/remove), non-CI. Every
   branch (Reject, denials, errors), every state, every scale case, and whole surfaces (cards, model pickers,
   settings, console, avatars) are untested. **No AI screen virtualizes** → scale is unproven.

**This plan closes both** with one principle: **the same scenarios, two lenses.**

- **MOCK lens** (hermetic, CI-capable): drives **scale**, **every branch/state**, **every UI surface**.
- **LIVE lens** (opt-in, skip-loud, non-CI): proves **real LLM/agent/execution correctness** using **OpenRouter
  free models only**, incl. **multi-inference** (different free model per worker) to validate the OMA integration.
- **Shared agent/goal fixtures feed both lenses** (owner rule). ≤10 workers; the current 4 are the seed set.

---

## 1. Reproducibility strategy (the hard constraint for the live lens)

Real free LLMs are non-deterministic and rate-limited. We make them *testable*, not deterministic:

- **Constrain the structure, never assert prose.** `goal-decompose.md` already forces **JSON-only** output
  (`{tasks:[{id,title,dependsOn,agent,workerId}]}`). Assert: `parsePlan` accepts it; task count; `dependsOn`
  edges; wave grouping; `workerId` ∈ roster — not wording.
- **Assert effects, like the runs-on matrix.** A tool-call *actually ran* (`listContainers` returned rows a
  worker cited; a file written on the target *reads back*). Effect assertions survive prose variance.
- **Temperature 0** where honored; small `MAX_STEPS`.
- **Rate-limit aware:** free tier = **20 req/min, 50 req/day** unfunded (1000/day if the account funded ≥$10
  once). Keep scenarios **few + sequential**; `429`/5xx → backoff → fallback model → **skip-loud**, never a red
  suite on rate-limit.
- **Skip-loud gate:** the whole live-AI file skips with a clear message when `OPENROUTER_API_KEY` is unset
  (`adapters/devKeys.ts` already reads it). Home: `vitest.live.config.mts` (never CI).
- **Prompt iteration is expected.** Budget time to tune the constrained system/goal prompts until the *structure*
  is stable across 3+ consecutive runs before locking a scenario.

## 2. Model selection — OpenRouter free, multi-inference (verify live before each run; roster shifts weekly)

- Worker **A** (Inspector, read-only, tool-calling): `nvidia/nemotron-3-nano-30b-a3b:free` (or `-super-120b-a12b:free`).
- Worker **B** (Editor, writes files): `qwen/qwen3-235b-a22b:free` — **different family ⇒ proves per-agent
  multi-inference routing through OMA**.
- Fallback chain: `meta-llama/llama-3.3-70b-instruct:free` → `openrouter/free` (auto-router). DeepSeek/Gemini/
  Mistral are **no longer free** (2026-07). Base URL `https://openrouter.ai/api/v1` (OpenAI-compatible; catalog
  already has provider id `openrouter`).

---

## PHASE 1 — Shared fixtures (foundation for both lenses)

**Files:** create `src/__tests__/support/aiAgents.ts`, `src/__tests__/support/aiRuns.ts`. Modify
`src/resources/ai/mock-workers.json` (derive from the fixture, or replace its loader).

- **Task 1.1 — canonical worker roster (≤10).** Define ONCE: `{id,name,specialty,systemPrompt,toolPolicy,
  execution,avatarId}` for the seed set (Inspector/Editor/Operator/Reviewer + room to 10). `systemPrompt`s reuse
  the real templates (`src/resources/prompts/goal-worker.md` tone + per-role specialty). Export
  `workersForMock()` (scripted model) and `workersForLive(models)` (assign OpenRouter free ids per worker).
- **Task 1.2 — constrained goals.** Define 2–3 goals whose decomposition shape is stable: e.g. `INSPECT_ONLY`
  (1 task, Inspector), `INSPECT_THEN_EDIT` (2 tasks, dep t1→t2, the screenshot's shape), `PARALLEL_TWO` (2
  independent tasks). Each with the *expected structural shape* (task count, edges, waves) for assertions.
- **Task 1.3 — point the mock worker store at the fixture** so mock UI + live tests share identical definitions
  (kills `mock-workers.json` drift). Verify: `yarn test:run` still green.

---

## PHASE 2 — Scale seeding infrastructure (mock lens)

No AI screen virtualizes; scale must be *seeded*, then measured live.

- **Task 2.1 — parametric Run seeder.** Extend `testing/aiMocks.ts createMockTeamRuns()` to accept a COUNT
  so one path yields a run with **N tasks** (e.g. `CONTAINER_DESKTOP_MOCK_SCALE=tasks:100`). Tasks fan into
  realistic waves (mix of `dependsOn`) so the graph + plan `<ol>` both get 100 rows.
- **Task 2.2 — parametric Runs-list seeder.** Seed **hundreds of runs** into the Runs board/table
  (`Run/ManageScreen.tsx` + `runBoard.ts`) via the mock store (`CONTAINER_DESKTOP_MOCK_SCALE=runs:300`).
- **Task 2.3 — parametric workers-list seeder.** Seed many worker cards/rows (roster capped at 10 for *runnable*
  agents, but the *list* can seed more to test the grid).
- **Task 2.4 — scale probe helper** in `support/cdp.mjs` usage: an `EVAL` snippet returning `{rendered, scrollTop
  reachable, firstPaintMs, interactiveAfterScroll}` for a container selector, plus a screenshot.

**Expected finding (flag, don't assume):** these will likely surface real jank at 100–300 items (no
virtualization). If so, a follow-up task is **add `@tanstack/react-virtual`** to the plan `<ol>`, task-graph
waves, and the Runs/Workers lists — but that's a *result* of the tests, proposed separately, not pre-baked.

---

## PHASE 3 — Mock UI suite: screen-by-screen, BOTH branches, at scale

**How (CLAUDE.md):** never component-test React. Seed deterministically → `CONTAINER_DESKTOP_MOCK=1 yarn dev` →
drive with `support/cdp.mjs` (`EVAL=` DOM assertions + screenshots). Fold the durable flows into
`support/e2e/ai/flows.mjs` (`yarn test:e2e:ai`, Playwright/CDP + Tauri WebdriverIO) so they're repeatable; use
CDP for iterative verification. **Never invent routes** — all cited below are from `Screen.Route.Path`/`Navigation.ts`.

### 3.1 Team Run — `screens/AI/Run/RunScreen.tsx` · route `/screens/ai/run/$runId`
Elements & **both branches**:
- Plan gate (`view.planPending`): **Approve plan** (`approvePlan(runId,"allow")`) → tasks start; **Reject**
  (`approvePlan(runId,"reject")`) → assert run cancels/stops, no task runs. *(Reject currently untested.)*
- Mid-run per-tool `ApprovalPrompt`: **Allow** vs **Reject** (`approveTool`), assert JSON args + "requested by
  {{task}}" render, and the tool proceeds/aborts accordingly.
- Task-graph `TaskNode` click → transcript shows `output` / `error` / **"Waiting for this agent to report…"**.
- **Stop** (disabled when `!active`); phase badge AWAITING-PLAN→running→synthesizing→done; token counter
  (`compactTokens`); synthesis **"Answer"** panel; **"This goal is no longer running"** not-in-store state.
- **SCALE:** 100-task seed → plan `<ol>` (100), waves graph (100 nodes) render + scroll + node-click still works.

### 3.2 Runs list — `screens/AI/Run/ManageScreen.tsx` · route `/screens/ai/runs` + `CreateDrawer.tsx` + `ActionsMenu.tsx` + `runBoard.ts`
- Board/Table toggle, search, row ActionsMenu (**open / stop / dismiss**), **New goal** drawer (goal text, token
  budget, optional roster) → `getRunClient().start`. Both branches: start vs cancel-drawer; dismiss vs open.
- **SCALE:** hundreds of Runs in board + table; search-filter responsiveness.

### 3.3 Workers — `screens/AI/Worker/ManageScreen.tsx` · route `/screens/ai/workers` + `CreateDrawer.tsx`
- List/Cards toggle, sort, search, **bulk actions** (`bulkActions.ts`), Avatars drawer.
- Editor (`CreateDrawer`, `#workerName`): identity+avatar, specialty, system prompt, model (inherit vs
  `WorkerModelPicker.tsx`), **tool policy** all/ask/granular grid (all=locked-checked; granular select + "select
  all"), **"Runs on"** `HTMLSelect` host/remote-SSH/existing-container/sandbox with conditional
  `ConnectionSelect`/container/image. Both branches: **create** vs **edit** path; valid vs validation-fail.
- **SCALE:** many worker rows/cards.

### 3.4 Assistant — `components/ai/AssistantThread.tsx` (route `/screens/ai/assistant`) + Console `AssistantConsole/AssistantConsoleHost.tsx` (Ctrl/Cmd+` toggle, header robot `data-action="ai-assistant"`) + `AIComposer.tsx`
- Chat send/stream/Stop; **permission-mode menu** ask/remember/**allow (confirm-gated)** *(security-critical)*;
  ModelPicker; Thread selector + delete + new; starter chips; auto-follow/jump.
- **Inline approval cards: Allow vs Reject + remember**; denied/error callouts.
- **Steering/interruption**: interrupt a stream mid-flight (segment abort), assert splice.
- Console: toggle both ways, resize, transparency, close.

### 3.5 Generative-UI tool cards — `components/ai/cards/registry.tsx` (+ Containers/Images/Networks/Volumes/LogViewer/ActionResult/File/Diff/Listing/Search/Exec + GenericToolCard)
- Largest untested visual surface. Seed one mock tool result per card type → assert each card renders its shape
  (not the generic JSON fallback). Screenshot each.

### 3.6 Settings AI — route `/screens/settings/user-settings?category=ai`
- `AIProviderConfig.tsx`: provider select, endpoint/API-key save+**reveal**, **Test** round-trip (success +
  failure), web-search toggle, workspace folder, degraded-encryption consent.
- `AIPermissions.tsx`: web-search allow/block/ask, allow/reject rule lists + reset.
- Model pickers: `ModelNavigator.tsx` drill-down (source→provider→model), discovery/error/not-configured states,
  `ModelPicker` persistence, `WorkerModelPicker`.

**Deliverable:** extend `support/e2e/ai/flows.mjs` with `goalRejectFlow`, `toolApprovalFlow`, `workerEditRunsOnFlow`,
`cardsFlow`, `settingsAiFlow`, `consoleFlow`, `scaleFlow`; each asserts DOM + captures a screenshot. Close the gap
list from `ui-surfaces.md`.

---

## PHASE 4 — Live LLM/agent/execution matrix (the real brain)

**New file:** `src/__tests__/live/ai-agent.live.test.ts` (`vitest.live.config.mts`, sequential, skip-loud on
missing `OPENROUTER_API_KEY`). Reuses Phase-1 fixtures + `src/__tests__/support/executionTargetMatrix.ts`'s
`ConnectionExecHost`. Real path: `createOmaAgentSession`/`createOmaTeamRun` (`omaTeamRun.ts`) → `createOmaAdapter` →
`new AISdkAdapter(createLanguageModel(resolved, providerFetch))` → real HTTP → OpenRouter.

- **L1 — Interactive chat + real tool-loop** [closes P0-1,2,4]. Constrained prompt forces a `listContainers`
  tool-call; assert the tool actually ran against engineOps and the model consumed the result and answered.
- **L2 — Team Run DAG multi-agent** [closes P0-3]. Run `INSPECT_THEN_EDIT`; assert `parsePlan` accepts the real
  decompose JSON; task count + `dependsOn` waves match the fixture's expected shape; plan-approval gate fires;
  each worker reports; synthesis (`goal-synthesis.md`) references task outputs.
- **L3 — Worker execution WITH a model deciding** [closes P1-5]. Point L2 at the **real execution selector** + a
  sandbox/remote target (reuse `executionTargetMatrix`); a worker, under model control, writes a file that
  **reads back** on its target. The product promise, currently untested end-to-end.
- **L4 — Multi-inference** [proves OMA integration]. Assign Worker A and Worker B **different free models**;
  assert both tasks produced output ⇒ OMA routed per-agent models through our adapter.

Automation: `package.json` script `test:ai:live` → `vitest run -c vitest.live.config.mts
src/__tests__/live/ai-agent.live.test.ts`. Document rate-limit posture + fallback in the file header.

---

## PHASE 5 — Docs, CI posture, rollout

- **Task 5.1** — `docs/testing.md` + `docs/testing-runs-on.md`: document the two lenses, the OpenRouter setup
  (`OPENROUTER_API_KEY`, free-model caveat, rate limits), `test:ai:live`, and the mock-scale env knobs.
- **Task 5.2** — CI decision (owner): the mock UI flows are the only AI UI automation and are **non-CI** today;
  decide whether to add an AI arm to the CI checks — see Open Decisions. Do **not** silently
  add CI steps (per `dont-add-ci-guard-steps-to-pipeline`).
- **Task 5.3** — verification: `yarn check-types` · `yarn lint` · `yarn test:run` green; `test:e2e:ai` drives the
  new flows against the mock app; `test:ai:live` green against real free models (or skips loud without a key);
  scale scenarios captured with screenshots + timing.

---

## Open decisions (resolve with the owner before executing — AskUserQuestion)

1. **L1/L3 tool target:** real local engine (podman/docker) for the model-driven tool-call + file write, or mock
   engineOps + `virtualEngineHost`? (Real = fuller proof, slower/needs engine; mock = hermetic-ish but less real.)
2. **Virtualization:** if Phase-2 scale probes show jank at 100–300 items, add `@tanstack/react-virtual` now, or
   report + defer to a separate task?
3. **CI:** add an AI arm to CI (the WebDriver specs need a display + a built binary), or keep AI UI automation local/non-CI?
4. **Phase order for Part A:** Runs (detail+list) + Workers first, Assistant/cards/settings second — agreed?

## Risks / notes
- Free-model roster shifts weekly + rate limits → live suite must be resilient (fallbacks, skip-loud) and small.
- Scale tests may expose real perf gaps → possible virtualization follow-up (own task).
- Reject/denial/error branches touch security-critical paths (permission-mode "always allow", tool floor) → high
  value, prioritize.
- Keep `@/ai-system/core` dependency-free; live test imports platform/runtime seams only from the test layer.
```

## Two-shell cleanup — deferred verification

- Go terminal argv — `src-wails/terminal_linux.go` (`linuxTerminalArgs`, `resolveExecutable`) has no test file. The Rust half is covered by `src-tauri/src/shell.rs` tests; port the same per-emulator table to a new `src-wails/terminal_linux_test.go`.
- `platform/commandProxyBroker.ts` + the `COMMAND_PROXY` channel names in `container-client/commandProxyProtocol.ts` have **no consumer but their own tests** — both shells invoke their native proxy directly (`{tauri,wails}/exec/proxy-request.ts`). Decide: delete the broker + channel constants, or keep them as the seam for a future shell whose engine HTTP crosses a process boundary. Do not delete before confirming no forwarding path is meant to route through it.
- `platform/appConfig.ts` likewise has **no consumer but its own test**. Window geometry is now native (`tauri_plugin_window_state`, `src-wails/window_state.go`), so `get/setWindowConfig` is superseded. Before deleting, confirm `isHideToTrayOnClose`'s `minimizeToSystemTray || trayWidgetEnabled` semantics still hold: the native close hooks arm hide-to-tray on **tray presence** alone (`src-tauri/src/lib.rs` `TrayState`, `src-wails/tray_service.go` `trayActive`), and the Settings → Startup toggle writes `minimizeToSystemTray`.
- Docs and a few comments still cite **pre-monorepo paths** (`src/platform/…`, `src/container-client/…`, `src/env/Types.ts`) instead of `src/packages/<pkg>/src/…`. Unrelated to the shell work; worth one mechanical sweep.
