// SCENARIO — `/changes status` : opens workspace changes
//
// `/changes status` opens the workspace changes drawer on its file list. The drawer reads the mounted folder, so an
// empty workspace is a legitimate answer — what is asserted is the surface, not that anything changed.
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

describe("/changes status — opens workspace changes", () => {
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

  it("opens the workspace changes drawer", async () => {
    await runByClick(browser, "/changes status");
    await $(".WorkspaceChangesDrawer").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/changes status did not open the workspace changes drawer",
    });
    await closeAnyDrawer(browser);
  });
});
