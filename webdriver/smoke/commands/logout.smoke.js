// SCENARIO — `/logout` : is never one click away from dropping a key
//
// `/logout` removes stored provider authentication, and the catalogue marks it `confirmation: required`. Removing a
// key is not undoable from here, so a single click in a popover must not do it — clicking writes it in instead.
//
// This scenario deliberately does NOT run the command. Doing so would delete the operator's real credential, which
// no test is entitled to do. What it proves is the guard: the click is inert, and the command is still offered.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  commandScenarioReason,
  draftText,
  openAssistant,
  runByClick,
  setDraft,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/logout — is never one click away from dropping a key", () => {
  before(async function () {
    const reason = await commandScenarioReason();
    if (reason) skipSuite(this, reason);
    await openAssistant(browser);
  });

  // The pair this scenario started is this scenario's to remove. Unconditional, because a failed test leaves a
  // container and a /24 behind exactly as reliably as a passing one.
  after(async () => {
    await stopSession(browser);
  });

  it("is written into the composer rather than run, because it asks to be confirmed", async () => {
    await runByClick(browser, "/logout");
    await browser.waitUntil(async () => (await draftText(browser)).includes("/logout"), {
      timeout: TIMEOUT,
      timeoutMsg: "clicking /logout neither ran nor inserted it — it must insert",
    });
    // Its own success notification is what running it looks like. Its absence is the assertion.
    const toasts = await browser.execute(() =>
      Array.from(document.querySelectorAll(".bp6-toast")).map((node) => node.textContent ?? ""),
    );
    assert.ok(
      !toasts.some((text) => /authentication removed/i.test(text)),
      "clicking /logout removed the stored credential",
    );
    await setDraft(browser, "");
  });
});
