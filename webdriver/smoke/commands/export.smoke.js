// SCENARIO — `/export` : opens the session export
//
// `/export` opens the app's own export surface, where the format is chosen. It stops there on purpose: choosing a
// destination is a native OS dialog, and this scenario goes no further than the drawer for the reason spelled out in
// import.smoke.js — WebDriver cannot dismiss a native dialog, and a spec that opens one wedges the session.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  closeAnyDrawer,
  commandScenarioReason,
  composerHint,
  openAssistant,
  runByClick,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/export — opens the session export", () => {
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

  it("opens the export drawer without writing anything", async () => {
    await runByClick(browser, "/export");
    await $(".SessionExportDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/export did not open the export drawer",
    });
    const hint = await composerHint(browser);
    assert.ok(!hint, `/export was refused: ${hint}`);
    await closeAnyDrawer(browser);
  });
});
