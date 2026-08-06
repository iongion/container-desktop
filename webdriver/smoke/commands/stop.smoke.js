// SCENARIO — `/stop` : stops the active turn
//
// `/stop` is the one command whose subject is a turn rather than a surface, so it is the one command that cannot be
// proved by opening something. It needs a model actually mid-answer, and it needs the refusal when there is none:
// declared `session-active`, `/stop` with nothing running must say so rather than quietly succeed.
//
// It is also the only command in the catalogue on the `always` bypass tier, which is what lets it run while the turn
// it interrupts is holding the composer. A `queued` command would wait for the very turn it was meant to stop.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  commandScenarioReason,
  openAssistant,
  openPalette,
  runByClick,
  runByTyping,
  setDraft,
  stopSession,
  turnIsActive,
  unavailableReason,
  waitForIdle,
  waitForTurn,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/stop — stops the active turn", () => {
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

  it("is refused, with the reason, when no turn is running", async () => {
    assert.equal(await turnIsActive(browser), false, "a turn was already running before the scenario started one");
    await setDraft(browser, "");
    await openPalette(browser);
    const refusal = await unavailableReason("/stop");
    assert.equal(refusal, "No active turn to stop", `/stop offered no reason for refusing while idle: ${refusal}`);
    await browser.keys(["Escape"]);
  });

  it("ends a turn that is running", async () => {
    // The same "type it and send" path a command takes, carrying a message instead. The prompt asks for something
    // long on purpose: a turn that finishes on its own before /stop lands would prove nothing about /stop.
    await runByTyping(browser, "Count slowly from 1 to 200, writing one number per line and nothing else.");
    await waitForTurn(browser);

    await runByClick(browser, "/stop");
    await waitForIdle(browser, TIMEOUT);
    assert.equal(await turnIsActive(browser), false, "/stop did not end the turn");
  });
});
