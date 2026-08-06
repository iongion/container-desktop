// SCENARIO — `/memory clear` : opens the review that precedes clearing
//
// `/memory clear` REVIEWS before clearing — it opens Project Memory with the clear action staged, and the user
// decides there. It must never be the clearing itself: that is why it is safe for a click to run it.
//
// This scenario asserts the non-destruction directly, by counting the memory rows before and after.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  closeAnyDrawer,
  commandScenarioReason,
  openAssistant,
  runByClick,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/memory clear — opens the review that precedes clearing", () => {
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

  it("opens the review and removes nothing on the way", async () => {
    await runByClick(browser, "/memory list");
    const drawer = await $(".AssistantContextDrawer");
    await drawer.waitForExist({ timeout: TIMEOUT });
    const before = await browser.execute(() => document.querySelectorAll(".AssistantContextRow").length);
    await closeAnyDrawer(browser);

    await runByClick(browser, "/memory clear");
    await $(".AssistantContextDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/memory clear did not open the review",
    });
    const after = await browser.execute(() => document.querySelectorAll(".AssistantContextRow").length);
    assert.equal(after, before, "/memory clear removed memories instead of offering to");
    await closeAnyDrawer(browser);
  });
});
