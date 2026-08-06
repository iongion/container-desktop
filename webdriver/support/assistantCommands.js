// Shared ground for the per-command scenarios in webdriver/smoke/commands/. There is one file per slash command
// the APP owns (docs/architecture/assistant-commands.md, generated from commandCatalog.ts), and each one asserts
// that the command does the thing it says it does — against a REAL app, not the mock.
//
// ONE prerequisite tier, and not by choice. The plan was to split these — a command that merely opens a drawer
// should not need a model to prove it — but the slash palette lives in the COMPOSER, and AssistantSession renders
// the launcher instead of a composer until a session is ready ("without a session the composer would accept text
// and silently drop it, so the surface offers a way to start one instead of a dead input"). With no composer there
// is no palette and no way to reach any command. So every scenario here needs a live pair, and the honest thing is
// to say so once rather than pretend otherwise per file.
//
// A missing prerequisite SKIPS with the fixing command in it. Nothing here starts an engine, builds an image or
// loads a model to make itself runnable — the operator's environment is theirs.
//
// HARNESS RULES, inherited from the specs that paid for them:
//   • An `async` page function handed to browser.execute does NOT work — WebKitWebDriver cannot serialize the
//     promise, and the rejection is reported against whichever command runs next.
//   • Never return an object with a key named `error`: WebdriverIO reads it as a W3C error response and throws.
//   • ONE saveScreenshot per session. These specs take none — everything they assert is DOM.

import { strict as assert } from "node:assert";
import path from "node:path";

import { agentImageReason, appModeReason, engineReason, firstReason, loadedModelReason } from "./prerequisites.js";

export const ENGINE = process.env.CD_LIVE_ENGINE ?? "podman";
export const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
// Unqualified on purpose: podman prefixes local images with `localhost/`, docker leaves them bare, and both
// resolve the short name.
export const AGENT_IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
export const MODEL = process.env.CD_LIVE_MODEL ?? "qwen3-4b-instruct-2507";
export const PROVIDER_URL = process.env.CD_LIVE_PROVIDER_URL ?? "http://127.0.0.1:1234/v1";
const USER_DATA = process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data");
// The folder the harness pre-seeds and points ai.workspaceRoot at. A session on a path that does not exist makes
// every project read answer "unconfigured".
export const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? path.join(USER_DATA, "workspace-fixture");
// pi's own prompt plus the app's project context is already several thousand tokens before the user says anything.
const MIN_CONTEXT = 8192;

export const ASSISTANT_SCREEN = '[data-screen="ai.assistant"]';
export const COMPOSER = ".AIComposerInput";
export const TRIGGER = ".AIComposerCommandTrigger";
export const PALETTE = ".AssistantCommandPalette";
export const TIMEOUT = 60000;

export function commandScenarioReason() {
  return firstReason([
    () => appModeReason("real"),
    () => engineReason(ENGINE),
    () => agentImageReason(ENGINE, AGENT_IMAGE),
    () => loadedModelReason(MODEL, MIN_CONTEXT),
  ]);
}

export async function waitReady(browser, timeout = TIMEOUT) {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const html = document.documentElement;
        return html.dataset.phase === "ready" && html.dataset.running === "yes" && html.dataset.provisioned === "yes";
      }),
    { timeout, interval: 500, timeoutMsg: "the app never reached the ready/running/provisioned phase" },
  );
}

// Every connection the app has actually brought up, asked of the engine service rather than the launcher's rows —
// the rows are rendered from a listing that may be a moment stale, and a session is started against an id.
async function runningConnections(browser) {
  const answer = await browser.executeAsync((done) => {
    window.AI.runEngineOp({ op: "listConnections", args: {} }).then(
      (result) => done({ ok: result.ok === true, value: result.value ?? [], reason: String(result.error ?? "") }),
      (failure) => done({ ok: false, value: [], reason: String(failure) }),
    );
  });
  return (answer.ok ? answer.value : []).filter((entry) => entry.running);
}

// Bring the Assistant up with a session behind it, because there is no command palette without one. The session is
// keyless and provider-less on purpose: with no providerId the host composes no gateway env file from the keychain,
// so nothing is read from the OS keyring and a run costs the operator's account nothing. `scheme: "none"` is what
// makes the gateway sign neither an api-key nor a bearer, which is what a local server wants.
export async function openAssistant(browser) {
  await waitReady(browser);
  await browser.execute(() => {
    window.location.hash = "#/screens/ai/assistant";
  });
  await $(ASSISTANT_SCREEN).waitForExist({ timeout: TIMEOUT });

  let connections = [];
  await browser.waitUntil(
    async () => {
      connections = await runningConnections(browser);
      return connections.length > 0;
    },
    { timeout: TIMEOUT, interval: 2000, timeoutMsg: "no engine connection came up — is any engine API listening?" },
  );
  const target = connections.find((entry) => entry.engine === ENGINE) ?? connections[0];

  const started = await browser.executeAsync(
    (options, done) => {
      const read = () => {
        const state = window.__cdCodingAgentStore.getState();
        return { status: state.status, reason: state.error ?? "", log: state.startLog.join(" | ") };
      };
      window.__cdCodingAgentStore
        .getState()
        .start(options)
        .then(
          () => done(read()),
          (failure) => done({ ...read(), reason: String(failure) }),
        );
    },
    {
      connectionId: target.id,
      workspacePath: WORKSPACE,
      modelId: MODEL,
      upstreamBaseUrl: PROVIDER_URL,
      upstreamAuth: { scheme: "none" },
      appVersion: APP_VERSION,
    },
  );
  assert.equal(started.status, "ready", `the session did not become ready: ${started.reason} [${started.log}]`);
  await $(`${ASSISTANT_SCREEN} ${COMPOSER}`).waitForExist({ timeout: TIMEOUT });
}

// TWO palettes exist — one anchored to the composer input, one to the toolbar button — and both can be mounted at
// once. Every lookup is scoped to the one actually on screen, because `data-command-index` is per-palette and the
// indices would otherwise collide.
export async function visibleRows() {
  const shown = [];
  for (const row of await $$(`${PALETTE} .AssistantCommandPaletteRow`)) {
    if (await row.isDisplayed()) shown.push(row);
  }
  return shown;
}

export async function paletteIsOpen() {
  return (await visibleRows()).length > 0;
}

export async function openPalette(browser) {
  if (!(await paletteIsOpen())) await $(TRIGGER).click();
  await browser.waitUntil(paletteIsOpen, { timeout: TIMEOUT, timeoutMsg: "the command palette never opened" });
}

export async function rowFor(commandPath) {
  for (const row of await visibleRows()) {
    if ((await row.$("code").getText()).trim() === commandPath) return row;
  }
  return undefined;
}

// The composer's live text. Read off the element rather than remembered, because a command that ran is defined
// partly by what it did NOT leave behind.
export function draftText(browser) {
  return browser.execute((selector) => document.querySelector(selector)?.value ?? "", COMPOSER);
}

export async function setDraft(browser, text) {
  await browser.execute(
    (selector, value) => {
      const input = document.querySelector(selector);
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    COMPOSER,
    text,
  );
}

// How a user runs a command that takes nothing: open the palette, click the row. The click IS the execution —
// that is the behaviour these scenarios are built on, so running them any other way would test something else.
export async function runByClick(browser, commandPath) {
  await setDraft(browser, "");
  await openPalette(browser);
  const row = await rowFor(commandPath);
  assert.ok(row, `the palette offers no row for ${commandPath}`);
  await row.click();
}

// How a user runs a command that needs arguments: type it and send. Clicking one of these deliberately only
// writes it in, since there is nothing to run until they have said what it applies to.
export async function runByTyping(browser, text) {
  await setDraft(browser, text);
  // Typing a slash opens the palette, and Enter there ACCEPTS the completion rather than submitting — so the
  // palette is dismissed first, and only then does Enter mean send. Without this the command is merely completed
  // and the scenario waits forever for something that was never sent.
  if (await paletteIsOpen()) {
    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => !(await paletteIsOpen()), { timeout: 10000, timeoutMsg: "palette stayed up" });
  }
  await browser.keys(["Enter"]);
}

// A command marked unavailable is refused BEFORE anything runs, and the row says why. Asserting the reason is how
// a scenario distinguishes "correctly refused" from "silently did nothing".
export async function unavailableReason(commandPath) {
  const row = await rowFor(commandPath);
  if (!row) return undefined;
  const className = await row.getAttribute("class");
  if (!className.includes("is-unavailable")) return undefined;
  return (await row.$(".AssistantCommandPaletteState").getText()).trim();
}

export async function closeAnyDrawer(browser) {
  await browser.keys(["Escape"]);
  await browser.pause(300);
}

// Every scenario starts a real pair, and NOTHING else will take it down: the app deliberately does not reap the
// user's containers, and each spec file is its own app instance. Left standing that is one pair and one /24 per
// file — which exhausts the engine's address pool and then surfaces, on some unrelated later run, as a network
// that "does not exist". A scenario that creates a pair owns removing it, and this must run even when the test
// that needed it failed.
export async function stopSession(browser) {
  await browser
    .executeAsync((done) => {
      const store = window.__cdCodingAgentStore;
      if (!store || store.getState().status === "idle") {
        done(true);
        return;
      }
      store
        .getState()
        .stop()
        .then(
          () => done(true),
          () => done(false),
        );
    })
    .catch(() => false);
}
