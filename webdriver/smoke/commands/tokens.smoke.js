// SCENARIO — `/tokens` : opens context and token usage
//
// `/tokens` opens the context drawer on Usage. The drawer existing is not the claim — `/tokens`, `/tools` and
// `/session` all open the SAME drawer and differ only in the section they land on, so the section is what is asserted.
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

describe("/tokens — opens context and token usage", () => {
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

  it("opens the context drawer on Usage", async () => {
    await runByClick(browser, "/tokens");
    await $(".AssistantContextDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/tokens did not open the context drawer",
    });
    const section = await contextDrawerSection(browser);
    assert.equal(section, "Usage", `/tokens landed on "${section}" instead of Usage`);
    await closeAnyDrawer(browser);
  });
});
