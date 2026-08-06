// SCENARIO — `/memory add` : carries the text into a memory draft
//
// `/memory add <text>` takes a REQUIRED argument, so clicking it must only write it into the composer — there is
// nothing to add until the user says what. Typed with its text, it opens the drawer carrying that text as a draft.
//
// Both halves matter: the click behaviour is what keeps the palette from creating half-formed memories, and the
// typed behaviour is what the command is for.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  closeAnyDrawer,
  commandScenarioReason,
  draftText,
  openAssistant,
  runByClick,
  runByTyping,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/memory add — carries the text into a memory draft", () => {
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

  it("is written into the composer when clicked, because it has nothing to add yet", async () => {
    await runByClick(browser, "/memory add");
    await browser.waitUntil(async () => (await draftText(browser)).includes("/memory add"), {
      timeout: TIMEOUT,
      timeoutMsg: "clicking /memory add neither ran nor inserted it",
    });
    assert.equal(
      (await $$(".AssistantContextDrawer")).length,
      0,
      "clicking /memory add opened the drawer — it should wait for the text",
    );
  });

  it("carries its text into the drawer when sent", async () => {
    const note = `deploy codeword ZEPHYR-${String(Date.now()).slice(-4)}`;
    await runByTyping(browser, `/memory add ${note}`);
    const drawer = await $(".AssistantContextDrawer");
    await drawer.waitForExist({ timeout: TIMEOUT, timeoutMsg: "/memory add did not open the context drawer" });
    await browser.waitUntil(async () => (await drawer.getText()).includes(note.slice(0, 20)), {
      timeout: TIMEOUT,
      timeoutMsg: "the drawer did not carry the text /memory add was given",
    });
    await closeAnyDrawer(browser);
  });
});
