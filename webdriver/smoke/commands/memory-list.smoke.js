// SCENARIO — `/memory list` : opens Project Memory
//
// `/memory list` (alias `/memory`) opens the context drawer on the project's memories.
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

describe("/memory list — opens Project Memory", () => {
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

  it("opens the project context drawer on memory", async () => {
    await runByClick(browser, "/memory list");
    await $(".AssistantContextDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/memory list did not open the context drawer",
    });
    await closeAnyDrawer(browser);
  });
});
