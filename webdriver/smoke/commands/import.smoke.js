// SCENARIO — `/import` : offered, and never triggered here
//
// `/import` picks a JSONL off the HOST, which means the very first thing it does is open a native file dialog. That
// dialog is drawn by the OS, not the webview: WebDriver cannot see it and cannot dismiss it, so it would sit there
// owning the app until the session timed out — and every later assertion in the run would fail against a modal
// nothing can close. So this scenario asserts everything that can be known WITHOUT running it, and deliberately
// never clicks the row: clicking one is what runs a command that takes no arguments.
//
// What is left to prove is that the command is genuinely reachable and genuinely permitted — that a user with a live
// session is offered `/import` and is not refused. The import itself is the one thing in the catalogue this suite
// cannot honestly cover, and saying so here is better than a test that pretends to.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  commandScenarioReason,
  openAssistant,
  openPalette,
  rowFor,
  setDraft,
  stopSession,
  unavailableReason,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/import — offered, and never triggered here", () => {
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

  it("is offered by the palette and not refused, with a live session", async () => {
    await setDraft(browser, "");
    await openPalette(browser);
    const row = await rowFor("/import");
    assert.ok(row, "the palette offers no row for /import");

    const refusal = await unavailableReason("/import");
    assert.equal(refusal, undefined, `/import was refused with a live session: ${refusal}`);

    // Left as it was found: the palette is dismissed rather than activated, because activating this row opens a
    // dialog no test can close.
    await browser.keys(["Escape"]);
  });
});
