// A transient provider failure the assistant retries by itself, driven on the mock session.
//
// The ORDER is pi's, and it is the whole difficulty: pi decides a failure is retryable only after the attempt has
// ended, so the app is told the model errored BEFORE it is told a retry is coming. It then has to take both back —
// the callout and the finished turn. What this spec pins is what the user sees while that happens: a session that
// never goes quiet, a wait that says which attempt it belongs to and counts itself down, and a transcript left with
// only the attempt pi gave up on — none here, because the retry succeeds.
//
// The mock emits the three frames synchronously, so React renders them as one and the withdrawn callout never
// paints. A real container delivers them as separate socket frames, where a sub-frame flash is possible; the
// assertion is about what remains, not about that frame.

import { strict as assert } from "node:assert";

const SCREEN = '[data-screen="ai.assistant"]';
const READY_TIMEOUT = 45000;

const snapshot = (screen) =>
  browser.execute((selector) => {
    const text = (node) => (node?.textContent ?? "").trim();
    return {
      working: text(document.querySelector(`${selector} .ThinkingStatusText`)),
      errors: document.querySelectorAll(`${selector} .AssistantError`).length,
      assistant: Array.from(document.querySelectorAll(`${selector} .AssistantMessage--assistant`)).map(text),
      stopping: document.querySelector(`${selector} .AIComposerStop`) !== null,
      phase: window.__cdCodingAgentStore?.getState().view?.phase ?? "idle",
    };
  }, screen);

describe("assistant retries", () => {
  let backingOff = {};
  let counted = {};
  let settled = {};

  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $(`${SCREEN} .AIComposerInput`).waitForExist({
      timeout: READY_TIMEOUT,
      timeoutMsg: "the composer never appeared — the mock session did not come up",
    });
    await browser.waitUntil(
      () => browser.execute(() => (window.__cdCodingAgentStore?.getState().sessionModel ?? "") !== ""),
      { timeout: READY_TIMEOUT, timeoutMsg: "the session never reported a model" },
    );

    // Set through the value setter and an input event: a repeated character typed key by key arrives collapsed.
    await browser.execute((selector) => {
      const input = document.querySelector(`${selector} .AIComposerInput`);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(input, "simulate retry");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    }, SCREEN);
    await browser.pause(200);
    await browser.execute((selector) => {
      document.querySelector(`${selector} .AIComposerSend`)?.click();
    }, SCREEN);

    // The backoff is the window this spec cares about: three seconds in which nothing arrives.
    await browser.waitUntil(
      async () => (await snapshot(SCREEN)).working.startsWith("Retrying"),
      { timeout: 20000, timeoutMsg: "the working indicator never said the turn was being retried" },
    );
    backingOff = await snapshot(SCREEN);
    await browser.pause(1200);
    counted = await snapshot(SCREEN);

    await browser.waitUntil(
      async () => {
        const now = await snapshot(SCREEN);
        return !now.stopping && now.phase === "idle";
      },
      { timeout: 40000, timeoutMsg: "the retried turn never finished" },
    );
    await browser.pause(400);
    settled = await snapshot(SCREEN);
  });

  it("keeps the turn in flight through the backoff", () => {
    assert.equal(backingOff.phase, "model");
    assert.equal(backingOff.stopping, true, "Stop was offered, so the session still owned the turn");
  });

  it("says which attempt the wait belongs to", () => {
    assert.match(backingOff.working, /^Retrying \(1\/3\)/);
  });

  it("counts the wait down rather than sitting on one number", () => {
    const secondsOf = (label) => Number(/in (\d+)s/.exec(label)?.[1] ?? -1);
    assert.ok(secondsOf(counted.working) < secondsOf(backingOff.working), `${backingOff.working} → ${counted.working}`);
  });

  it("shows no failure for an attempt it went on to recover from", () => {
    assert.equal(backingOff.errors, 0);
    assert.equal(settled.errors, 0);
  });

  it("delivers the answer the retry produced", () => {
    assert.equal(settled.working, "");
    assert.ok(
      settled.assistant.some((text) => text.includes("the retry went through")),
      `assistant messages: ${JSON.stringify(settled.assistant)}`,
    );
  });
});
