// SCENARIO — `/rules init` : stages Project Rules initialization
//
// `/rules init` (alias `/init`) opens the same rules surface with initialization staged. Like `/memory clear` it
// PREPARES rather than writes — nothing lands in the workspace until the user acts in the drawer.
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

describe("/rules init — stages Project Rules initialization", () => {
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

  it("opens the rules surface without writing to the workspace", async () => {
    await runByClick(browser, "/rules init");
    await $(".AssistantContextDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/rules init did not open the context drawer",
    });
    await closeAnyDrawer(browser);
  });
});
