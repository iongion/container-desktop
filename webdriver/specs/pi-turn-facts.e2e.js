import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Two things the app used to leave the user to work out, both found by driving a REAL model and neither visible in
// mock mode until now:
//
//   a turn that produced NOTHING — a 4B model emitting a stop token immediately looked exactly like a turn that
//   never ran, and only the inference server's log told the two apart
//   a model with no room for the session — gemma loaded at 4096 against pi's own ~4.6k-token prompt failed the next
//   TURN with llama.cpp's words, though both numbers were known at the moment of the pick
//
// One session, driven the way a user drives it. The empty turn goes first because it is what makes the session
// publish a context report — without one there is no prompt to measure a window against, which is also true of the
// real app. The provider listing is a loopback stub in OpenRouter's shape: no network, no key, and the probe that
// reads it is the shipped one.

const SCREEN = '[data-screen="ai.assistant"]';
const ROOMY_MODEL = "openai/gpt-5.5";
const CRAMPED_MODEL = "tiny/window-2048";
const ENTRIES = {
  [ROOMY_MODEL]: { id: ROOMY_MODEL, context_length: 400_000 },
  // 2048 tokens cannot hold this session's prompt and tools plus the 4096 pi reserves for an answer.
  [CRAMPED_MODEL]: { id: CRAMPED_MODEL, context_length: 2048 },
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETTINGS_FILE = path.join(
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(repoRoot, "webdriver", ".e2e-user-data"),
  "user-settings.json",
);

let stub;

const startStub = () =>
  new Promise((resolve) => {
    stub = createServer((request, response) => {
      const listing = request.url?.startsWith("/api/v1/models") ? { data: Object.values(ENTRIES) } : { data: [] };
      response.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      response.end(JSON.stringify(listing));
    });
    stub.listen(0, "127.0.0.1", () => resolve(stub.address().port));
  });

let empty = {};
let roomy = {};
let cramped = {};

describe("assistant turn facts", () => {
  before(async () => {
    const port = await startStub();
    const settings = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
    const ai = settings.ai ?? {};
    settings.ai = {
      ...ai,
      defaultProvider: "openrouter",
      providers: { ...(ai.providers ?? {}), openrouter: { model: "", baseURL: `http://127.0.0.1:${port}/api/v1` } },
    };
    writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);

    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $(`${SCREEN} .AIComposerInput`).waitForExist({
      timeout: 45000,
      timeoutMsg: "the composer never appeared — the scripted session did not come up",
    });
    await browser.waitUntil(
      () => browser.execute(() => (window.__cdCodingAgentStore?.getState().sessionModel ?? "") !== ""),
      { timeout: 30000, timeoutMsg: "the session never reported a model" },
    );

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

    // Toasts expire on their own, so they are collected as they appear rather than looked for afterwards.
    const watchToasts = () =>
      browser.execute(() => {
        window.__cdToasts = [];
        window.clearInterval(window.__cdToastPoll);
        window.__cdToastPoll = window.setInterval(() => {
          for (const node of document.querySelectorAll(".NotificationAppToaster .bp6-toast-message")) {
            const text = node.textContent ?? "";
            if (text && !window.__cdToasts.includes(text)) window.__cdToasts.push(text);
          }
        }, 100);
      });
    const collectToasts = () =>
      browser.execute(() => {
        window.clearInterval(window.__cdToastPoll);
        return window.__cdToasts ?? [];
      });

    await type("simulate an empty answer");
    await send();
    await settle("the empty turn never finished");
    await browser.pause(400);
    empty = await browser.execute((screen) => {
      const text = (node) => node?.textContent ?? "";
      return {
        user: Array.from(document.querySelectorAll(`${screen} .AssistantMessage--user`)).map(text),
        assistant: document.querySelectorAll(`${screen} .AssistantMessage--assistant`).length,
        notices: Array.from(document.querySelectorAll(`${screen} .AssistantTurnNotice`)).map(text),
        // The report the notice's turn published, which is what a window is measured against.
        reported: !!window.__cdCodingAgentStore?.getState().view?.context,
      };
    }, SCREEN);

    const switchTo = async (id) => {
      await watchToasts();
      await type(`/model ${id}`);
      await send();
      await browser.waitUntil(
        () => browser.execute((target) => window.__cdCodingAgentStore?.getState().sessionModel === target, id),
        { timeout: 45000, timeoutMsg: `the session never moved to ${id}` },
      );
      await browser.pause(600);
      return { model: id, toasts: await collectToasts() };
    };

    roomy = await switchTo(ROOMY_MODEL);
    cramped = await switchTo(CRAMPED_MODEL);
  });

  after(() => {
    stub?.close();
  });

  it("says the model answered with nothing instead of showing an empty turn", () => {
    assert.equal(empty.user.length, 1, "the prompt must have reached the transcript");
    assert.equal(empty.assistant, 0, "the model said nothing — there is no message to show");
    assert.equal(empty.notices.length, 1, "and exactly one notice saying so");
    assert.ok(
      empty.notices[0].includes("answered with nothing"),
      `the notice must name what happened, got "${empty.notices[0]}"`,
    );
    assert.ok(empty.reported, "the turn must have published a context report for the window check to use");
  });

  it("says nothing about room for a model that has plenty", () => {
    assert.ok(
      roomy.toasts.some((text) => text.includes(ROOMY_MODEL)),
      `the switch is still confirmed by name, got ${JSON.stringify(roomy.toasts)}`,
    );
    assert.equal(
      roomy.toasts.some((text) => text.includes("reports room for")),
      false,
      "a 400k window holds this session comfortably",
    );
  });

  it("warns with both numbers when the picked model has no room for the session", () => {
    const warning = cramped.toasts.find((text) => text.includes("reports room for"));
    assert.ok(warning, `the switch must warn, got ${JSON.stringify(cramped.toasts)}`);
    assert.ok(warning.includes(CRAMPED_MODEL), "the warning names the model");
    assert.ok(warning.includes("2048"), "and the window its provider published");
    // The session's own prompt, tools and the room reserved for an answer — over 4096 on any reading.
    assert.ok(/\b4\d{3,}\b/.test(warning), `and what this session needs, got "${warning}"`);
  });
});
