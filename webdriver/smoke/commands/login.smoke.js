// SCENARIO — `/login` : opens where provider credentials are entered
//
// `/login` navigates to the AI settings, which is where a key is entered. The credential never crosses into the
// session — this command only takes the user to the surface that owns it.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  commandScenarioReason,
  openAssistant,
  runByClick,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/login — opens where provider credentials are entered", () => {
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

  it("navigates to the AI settings", async () => {
    await runByClick(browser, "/login");
    await browser.waitUntil(
      async () => (await browser.execute(() => window.location.hash)).includes("settings"),
      { timeout: TIMEOUT, timeoutMsg: "/login did not navigate to settings" },
    );
    const hash = await browser.execute(() => window.location.hash);
    assert.ok(/category=ai/.test(hash), `/login landed somewhere other than the AI settings: ${hash}`);
  });
});
