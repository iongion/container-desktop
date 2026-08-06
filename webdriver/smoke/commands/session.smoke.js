// SCENARIO — `/session` : shows session info and stats
//
// pi's `/session` prints its info and stats. Here that IS the usage panel, so `/session` deliberately lands on the
// same section as `/tokens` rather than opening a second surface that would say the same thing in another shape. The
// scenario asserts that on purpose: were it to drift onto its own panel, this is the test that should fail.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  closeAnyDrawer,
  commandScenarioReason,
  contextDrawerSection,
  openAssistant,
  runByClick,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/session — shows session info and stats", () => {
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

  it("opens the usage panel, the same one /tokens opens", async () => {
    await runByClick(browser, "/session");
    await $(".AssistantContextDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/session did not open the context drawer",
    });
    const section = await contextDrawerSection(browser);
    assert.equal(section, "Usage", `/session landed on "${section}" instead of Usage`);
    await closeAnyDrawer(browser);
  });
});
