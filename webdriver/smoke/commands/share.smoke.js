// SCENARIO — `/share` : offered, and never triggered here
//
// `/share` writes the conversation as one standalone HTML file wherever the user says — so, like `/import`, its first
// act is a native OS dialog that WebDriver can neither see nor dismiss (import.smoke.js explains what that costs).
// The row is therefore asserted and never activated.
//
// Worth stating plainly: pi's `/share` posts a gist. This one does not — it saves a file, and nothing leaves the
// machine. That difference is the reason the command exists in this shape, and it is why triggering it in a test would
// write a file into the operator's filesystem rather than call an API that could be pointed somewhere harmless.
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

describe("/share — offered, and never triggered here", () => {
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
    const row = await rowFor("/share");
    assert.ok(row, "the palette offers no row for /share");

    const refusal = await unavailableReason("/share");
    assert.equal(refusal, undefined, `/share was refused with a live session: ${refusal}`);

    await browser.keys(["Escape"]);
  });
});
