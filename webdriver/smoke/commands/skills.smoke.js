// SCENARIO — `/skills` : opens the skill library
//
// The skill library is a drawer. Running the command has to OPEN it — the failure this guards against is the command
// being written into the composer instead, which looks identical until you notice nothing happened.
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
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/skills — opens the skill library", () => {
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

  it("opens the skill library", async () => {
    await runByClick(browser, "/skills");
    await $(".AssistantSkillsDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/skills did not open the skill library",
    });
    assert.ok(!(await draftText(browser)).includes("/skills"), "/skills was typed into the composer instead of run");
    await closeAnyDrawer(browser);
  });
});
