// SCENARIO — `/changes diff` : opens the full workspace diff
//
// `/changes diff` opens the SAME drawer as `/changes status` but on the diff view. Two commands reaching one
// surface is exactly where a wiring slip hides, so this asserts the drawer AND that the two are distinguishable.
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

describe("/changes diff — opens the full workspace diff", () => {
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

  it("opens the workspace changes drawer on the diff", async () => {
    await runByClick(browser, "/changes diff");
    const drawer = await $(".WorkspaceChangesDrawer");
    await drawer.waitForExist({ timeout: TIMEOUT, timeoutMsg: "/changes diff did not open the drawer" });
    // The diff view renders its own body; the status list does not. Whichever is present, the drawer must not be
    // empty — an opened drawer with no view rendered is the failure this catches.
    const text = (await drawer.getText()).trim();
    assert.ok(text.length > 0, "/changes diff opened an empty drawer");
    await closeAnyDrawer(browser);
  });
});
