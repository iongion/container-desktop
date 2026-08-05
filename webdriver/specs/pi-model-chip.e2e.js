import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The composer's model chip on the WebKitGTK shell: what it names while a session runs, that a `/model <id>`
// typed into the composer re-points that RUNNING session in place, and that the conversation survives it. The
// chip was built and driven on the Wails shell only, so this shell has never seen it — which is the whole
// reason the spec exists rather than another unit test.
//
// Session-bound is the claim under test. In front of a live session the chip shows what that session is
// answering with, not the saved default the next session would start on: a pick re-points the session and is
// never written back as anybody's default. The saved settings are read off disk either side of the switch to
// prove the second half, because "it did not persist" is not visible in the DOM.
//
// Everything goes into ONE session, driven the way a user drives it — type into `.AIComposerInput`, click
// `.AIComposerSend` — and read back as DOM plus store snapshots. No screenshot: nothing here is a paint question.

const SCREEN = '[data-screen="ai.assistant"]';
const BOOT_MODEL = "mock-assistant";
const SWITCH_TO = "qwen3-4b-instruct-2507";
// Matches none of the mock's tool scripts (container/image/network/volume/log/restart) nor its web-search,
// project-context or forced-error triggers, so the turn is one plain streamed reply with no approval card
// parked in front of it.
const PROMPT = "Say hello, briefly.";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETTINGS_FILE = path.join(
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(repoRoot, "webdriver", ".e2e-user-data"),
  "user-settings.json",
);

// What the app has SAVED as its default source and model — the thing a session-bound pick must leave alone.
const savedSelection = () => {
  if (!existsSync(SETTINGS_FILE)) return { missing: true };
  const ai = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")).ai ?? {};
  return { defaultProvider: ai.defaultProvider ?? "", providers: ai.providers ?? {} };
};

let booted = {};
let answered = {};
let switched = {};
let scoped = {};
let savedBefore = {};
let savedAfter = {};

describe("assistant model chip", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $(SCREEN).waitForExist({ timeout: 45000, timeoutMsg: "the Assistant screen never mounted" });
    await $(`${SCREEN} .AIComposerInput`).waitForExist({
      timeout: 30000,
      timeoutMsg: "the composer never appeared — the scripted session did not come up",
    });
    // The chip is fed by what the session REPORTS it runs, which arrives on the bridge's ready event.
    await browser.waitUntil(
      () => browser.execute(() => (window.__cdCodingAgentStore?.getState().sessionModel ?? "") !== ""),
      { timeout: 30000, timeoutMsg: "the session never reported a model" },
    );

    const snapshot = (screen) => {
      const state = window.__cdCodingAgentStore.getState();
      const text = (node) => node?.textContent ?? "";
      return {
        status: state.status,
        sessionModel: state.sessionModel ?? "",
        contextModel: state.view?.context?.model ?? "",
        chip: text(document.querySelector(`${screen} .AIComposerToolbar .ModelPickerTriggerLabel`)),
        chips: document.querySelectorAll(`${screen} .AIComposerToolbar .ModelPickerTriggerLabel`).length,
        user: Array.from(document.querySelectorAll(`${screen} .AssistantMessage--user`)).map(text),
        assistant: document.querySelectorAll(`${screen} .AssistantMessage--assistant`).length,
        streaming: document.querySelector(`${screen} .AIComposerStop`) !== null,
      };
    };

    booted = await browser.execute(snapshot, SCREEN);

    const type = async (value) => {
      await browser.execute(
        (screen, text) => {
          const input = document.querySelector(`${screen} .AIComposerInput`);
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
          setter?.call(input, text);
          input?.dispatchEvent(new Event("input", { bubbles: true }));
        },
        SCREEN,
        value,
      );
      await browser.pause(200);
    };
    const send = () =>
      browser.execute((screen) => {
        document.querySelector(`${screen} .AIComposerSend`)?.click();
      }, SCREEN);
    const settle = (message) =>
      browser.waitUntil(
        () =>
          browser.execute(
            (screen) =>
              document.querySelector(`${screen} .AIComposerStop`) === null &&
              (window.__cdCodingAgentStore?.getState().view?.phase ?? "idle") === "idle",
            SCREEN,
          ),
        { timeout: 60000, timeoutMsg: message },
      );

    // A conversation to lose. Without a turn behind it, "the transcript survived the switch" says nothing.
    await type(PROMPT);
    await send();
    const sent = (screen) => document.querySelectorAll(`${screen} .AssistantMessage--user`).length > 0;
    await browser.waitUntil(() => browser.execute(sent, SCREEN), {
      timeout: 30000,
      timeoutMsg: "the message never reached the transcript",
    });
    await settle("the turn never finished");
    answered = await browser.execute(snapshot, SCREEN);

    // Toasts expire on their own, so the confirmation is collected as it appears rather than looked for after.
    await browser.execute(() => {
      window.__cdChipToasts = [];
      window.__cdChipToastPoll = window.setInterval(() => {
        for (const node of document.querySelectorAll(".NotificationAppToaster .bp6-toast-message")) {
          const text = node.textContent ?? "";
          if (text && !window.__cdChipToasts.includes(text)) window.__cdChipToasts.push(text);
        }
      }, 100);
    });

    savedBefore = savedSelection();
    await type(`/model ${SWITCH_TO}`);
    await send();
    await browser.waitUntil(
      () => browser.execute((id) => window.__cdCodingAgentStore?.getState().sessionModel === id, SWITCH_TO),
      { timeout: 45000, timeoutMsg: `the session never moved to ${SWITCH_TO}` },
    );
    await browser.pause(500);
    switched = {
      ...(await browser.execute(snapshot, SCREEN)),
      toasts: await browser.execute(() => {
        window.clearInterval(window.__cdChipToastPoll);
        return window.__cdChipToasts ?? [];
      }),
    };
    savedAfter = savedSelection();

    // What the session has actually been pointed at — the set the container registers one pick at a time.
    await type("/scoped-models");
    await send();
    await $(".AssistantSettingsDrawer").waitForExist({
      timeout: 30000,
      timeoutMsg: "/scoped-models never answered with the settings drawer",
    });
    await browser.pause(400);
    scoped = await browser.execute(() => {
      const panel = Array.from(document.querySelectorAll(".AssistantSettingsDrawer .AssistantSettingsPanel")).find(
        (section) => section.querySelector(".AssistantSettingsNotice")?.textContent?.includes("Ctrl+P"),
      );
      const body = document.querySelector(".AssistantSettingsDrawer .bp6-drawer-body");
      return {
        models: Array.from(panel?.querySelectorAll(".AssistantSettingsRow strong") ?? []).map(
          (node) => node.textContent ?? "",
        ),
        notice: panel?.querySelector(".AssistantSettingsNotice")?.textContent ?? "",
        panelHeight: body?.scrollHeight ?? 0,
      };
    });
  });

  it("names the model the running session answers with", () => {
    assert.equal(booted.status, "ready", "the scripted session must be up before the chip means anything");
    assert.equal(booted.sessionModel, BOOT_MODEL);
    assert.equal(booted.chips, 1, "the Assistant surface carries exactly one chip");
    assert.ok(
      booted.chip.includes(BOOT_MODEL),
      `the chip must name the session's model, got "${booted.chip}"`,
    );
    assert.ok(
      booted.chip.includes("/"),
      `the chip names the source alongside the model, got "${booted.chip}"`,
    );
  });

  it("keeps the chip on that model while the session answers a turn", () => {
    assert.equal(answered.user.length, 1, "the turn must have gone through the composer");
    assert.ok(answered.user[0].includes(PROMPT), `the transcript must carry what was typed, got "${answered.user[0]}"`);
    assert.ok(answered.assistant > 0, "the session must have answered");
    assert.equal(answered.sessionModel, BOOT_MODEL, "answering does not change what is answering");
    assert.ok(answered.chip.includes(BOOT_MODEL));
    assert.equal(answered.contextModel, BOOT_MODEL, "the session's own context report names the live model");
  });

  it("re-points the running session when /model names another model", () => {
    assert.equal(switched.sessionModel, SWITCH_TO, "the session must be answering with the model just named");
    assert.ok(switched.chip.includes(SWITCH_TO), `the chip must follow the session, got "${switched.chip}"`);
    assert.equal(switched.chip.includes(BOOT_MODEL), false, "the model it left must be gone from the chip");
    assert.equal(switched.contextModel, SWITCH_TO, "the context report must describe the model now answering");
    assert.ok(
      switched.toasts.some((text) => text.includes(SWITCH_TO)),
      `the switch must be confirmed by name, got ${JSON.stringify(switched.toasts)}`,
    );
  });

  it("carries the conversation across the switch", () => {
    assert.deepEqual(switched.user, answered.user, "the user's message must survive a model switch");
    assert.equal(switched.assistant, answered.assistant, "the answer must survive it too");
    assert.equal(switched.status, "ready", "the session is re-pointed in place, never restarted");
    assert.equal(switched.streaming, false, "a switch is not a turn");
  });

  it("changes nothing a later session would start on", () => {
    assert.equal(savedBefore.missing, undefined, "the isolated settings file must exist to prove anything");
    assert.deepEqual(savedAfter, savedBefore, "a session-bound pick must not be written back as a default");
    assert.equal(
      JSON.stringify(savedAfter.providers).includes(SWITCH_TO),
      false,
      `nothing saved may name ${SWITCH_TO}`,
    );
  });

  it("lists only the models this session has been pointed at", () => {
    assert.deepEqual(
      scoped.models,
      [BOOT_MODEL, SWITCH_TO],
      "the set grows one pick at a time — a provider's catalogue is never registered up front",
    );
    assert.ok(scoped.notice.includes("2"), `the count is the point, got "${scoped.notice}"`);
    // Two rows come to 679px of panel, nearly all of it header, notice and padding. The catalogue this replaced
    // measured 3276px — 51 rows off LM Studio, and ~300 off OpenRouter — so a bound well under that is what stops
    // a provider's whole listing being registered up front again.
    assert.ok(
      scoped.panelHeight > 0 && scoped.panelHeight < 1200,
      `the list must stay this session's models, got ${scoped.panelHeight}px of panel`,
    );
  });
});
