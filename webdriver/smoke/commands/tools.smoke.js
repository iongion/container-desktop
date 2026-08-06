// SCENARIO — `/tools` : opens the effective tools
//
// `/tools` opens the context drawer on Tools — the tools this session actually has, after permissions. It shares the
// drawer with `/tokens` and `/session`, so landing on the right section is the whole claim.
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

describe("/tools — opens the effective tools", () => {
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

  it("opens the context drawer on Tools", async () => {
    await runByClick(browser, "/tools");
    await $(".AssistantContextDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/tools did not open the context drawer",
    });
    const section = await contextDrawerSection(browser);
    assert.equal(section, "Tools", `/tools landed on "${section}" instead of Tools`);
    await closeAnyDrawer(browser);
  });
});
