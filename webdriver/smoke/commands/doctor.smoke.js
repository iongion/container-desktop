// SCENARIO — `/doctor` : opens AI system health
//
// `/doctor` (alias `/status`) opens the diagnostics drawer. Both spellings have to reach the same surface — an alias
// that resolves to nothing is the kind of break the catalogue's own table cannot catch.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  closeAnyDrawer,
  commandScenarioReason,
  openAssistant,
  runByClick,
  runByTyping,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/doctor — opens AI system health", () => {
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

  it("opens the diagnostics drawer", async () => {
    await runByClick(browser, "/doctor");
    await $(".AssistantDiagnosticsDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/doctor did not open the diagnostics drawer",
    });
    await closeAnyDrawer(browser);
  });

  it("answers to its alias too", async () => {
    await runByTyping(browser, "/status");
    await $(".AssistantDiagnosticsDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/status did not reach the same drawer as /doctor",
    });
    await closeAnyDrawer(browser);
  });
});
