// SCENARIO — `/quit` : stops the session
//
// pi's `/quit` quits pi, which here means tearing down the container pair. It is the only command in the catalogue
// declared `confirmation: "required"`, and that declaration is why clicking its palette row does NOT run it: a command
// that asked to be confirmed must not have a single-gesture path to doing the very thing it wanted confirmed. That
// guard is asserted first.
//
// What is NOT asserted is a confirmation prompt, because there is no execution path that honours `confirmation` — typed
// and sent, `/quit` runs unconfirmed today. This scenario therefore pins the behaviour that exists rather than the one
// that is declared, and the gap is a known deferral. If a confirmation step is added, THIS is the test that should
// start failing, and its failure is the reminder to come back here.
//
// The teardown is real, so it goes last in the file: everything after it would be running against no session.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  ASSISTANT_SCREEN,
  COMPOSER,
  TIMEOUT,
  commandScenarioReason,
  draftText,
  openAssistant,
  runByClick,
  runByTyping,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

function sessionStatus(browser) {
  return browser.execute(() => window.__cdCodingAgentStore?.getState().status ?? "<no store>");
}

describe("/quit — stops the session", () => {
  before(async function () {
    const reason = await commandScenarioReason();
    if (reason) skipSuite(this, reason);
    await openAssistant(browser);
  });

  // Still unconditional even though the last test tears the pair down itself: an earlier failure would leave it
  // standing, and a container and a /24 outlive a failed test exactly as reliably as a passing one.
  after(async () => {
    await stopSession(browser);
  });

  it("is only written into the composer when clicked, never run", async () => {
    await runByClick(browser, "/quit");
    assert.equal(await draftText(browser), "/quit", "clicking /quit did not write it into the composer");
    assert.equal(await sessionStatus(browser), "ready", "clicking /quit stopped the session it only meant to offer");
  });

  it("tears the session down when sent", async () => {
    await runByTyping(browser, "/quit");
    await browser.waitUntil(async () => (await sessionStatus(browser)) === "idle", {
      timeout: TIMEOUT,
      interval: 500,
      timeoutMsg: "/quit left the session running",
    });
    // With no session there is no composer — the surface offers a way to start one instead of a dead input.
    await $(`${ASSISTANT_SCREEN} ${COMPOSER}`).waitForExist({
      timeout: TIMEOUT,
      reverse: true,
      timeoutMsg: "the composer outlived the session /quit stopped",
    });
  });
});
