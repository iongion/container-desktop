// SCENARIO — `/memory remove` : opens the drawer on an entry to remove
//
// `/memory remove <id>` also takes a REQUIRED argument. It does not remove anything on its own — it opens Project
// Memory pointed at the entry, so the removal is the user's click in a surface that shows them what it is.
//
// That distinction is the point of this scenario: a command whose name says "remove" must not remove on sight.
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

describe("/memory remove — opens the drawer on an entry to remove", () => {
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

  it("is written into the composer when clicked, and removes nothing", async () => {
    await runByClick(browser, "/memory remove");
    await browser.waitUntil(async () => (await draftText(browser)).includes("/memory remove"), {
      timeout: TIMEOUT,
      timeoutMsg: "clicking /memory remove neither ran nor inserted it",
    });
    assert.equal(
      (await $$(".AssistantContextDrawer")).length,
      0,
      "clicking /memory remove acted before it was told what to act on",
    );
  });

  it("opens Project Memory rather than deleting, when sent with an id", async () => {
    await runByTyping(browser, "/memory remove not-a-real-entry-id");
    await $(".AssistantContextDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/memory remove did not open the context drawer",
    });
    await closeAnyDrawer(browser);
  });
});
