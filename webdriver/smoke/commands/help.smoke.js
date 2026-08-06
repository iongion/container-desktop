// SCENARIO — `/help` : reopens the palette on a query
//
// `/help` does not print help — it puts the palette back up, filtered by whatever was typed after it. The proof is
// that the palette is open AGAIN after the click that closed it, and the composer carries the query it reopened on.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  commandScenarioReason,
  draftText,
  openAssistant,
  paletteIsOpen,
  runByClick,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/help — reopens the palette on a query", () => {
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

  it("puts the palette back up, filtered", async () => {
    await runByClick(browser, "/help");
    await browser.waitUntil(paletteIsOpen, {
      timeout: TIMEOUT,
      timeoutMsg: "/help did not reopen the command palette",
    });
    // The effect writes the query back into the composer, which is what the reopened palette is filtering on.
    assert.ok((await draftText(browser)).startsWith("/"), "/help left no query for the palette to filter on");
  });
});
