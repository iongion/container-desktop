// SCENARIO — `/model` : opens the selector, or re-points the session
//
// `/model` is two commands wearing one name: bare it opens the selector, and with pi's own `<provider/model>` argument
// it switches the running session straight away. Both are covered here against a real session, because the switch is
// the one that matters — it re-points a LIVE session in place, with no container restart and no lost conversation.
//
// It is also the only command declared `session-idle-only`, so the third claim is the refusal: mid-turn it must decline
// with a reason rather than swap the model out from under an answer already being written.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  MODEL,
  TIMEOUT,
  closeAnyDrawer,
  collectNotifications,
  collectedNotifications,
  commandScenarioReason,
  composerHint,
  openAssistant,
  openPalette,
  runByClick,
  runByTyping,
  setDraft,
  stopSession,
  unavailableReason,
  waitForIdle,
  waitForTurn,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/model — opens the selector, or re-points the session", () => {
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

  it("opens the model selector when it is given nothing", async () => {
    await runByClick(browser, "/model");
    await $(".ModelPickerPopover").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/model did not open the model selector",
    });
    await closeAnyDrawer(browser);
  });

  // Honest limit, and the reason this asserts the announcement rather than a changed value: only ONE model is
  // guaranteed resident on the machine running this, and re-pointing a session at the model it already answers with
  // leaves `sessionModel` unchanged — so a value comparison would pass without the command doing anything at all.
  // What IS observable is that the command ran the switch path to completion and named the model. Two DIFFERENT models
  // are switched between in webdriver/specs/pi-model-chip.e2e.js, where fixtures can offer a second one for free.
  it("re-points the running session when it is given a model", async () => {
    await collectNotifications(browser);
    await runByTyping(browser, `/model ${MODEL}`);
    await browser.waitUntil(async () => (await collectedNotifications(browser)).some((text) => text.includes(MODEL)), {
      timeout: TIMEOUT,
      interval: 500,
      timeoutMsg: `/model ${MODEL} never announced the model the session answers with`,
    });
    const hint = await composerHint(browser);
    assert.ok(!hint, `/model ${MODEL} was refused: ${hint}`);
    const sessionModel = await browser.execute(() => window.__cdCodingAgentStore?.getState().sessionModel ?? "");
    assert.equal(sessionModel, MODEL, `the session was left pointing at "${sessionModel}"`);
  });

  it("declines mid-turn rather than swapping the model under an answer", async () => {
    await runByTyping(browser, "Count slowly from 1 to 200, writing one number per line and nothing else.");
    await waitForTurn(browser);

    await setDraft(browser, "");
    await openPalette(browser);
    const refusal = await unavailableReason("/model");
    assert.equal(
      refusal,
      "Wait for the active turn to finish",
      `/model gave no reason for declining mid-turn: ${refusal}`,
    );
    await browser.keys(["Escape"]);

    // Left idle for the teardown that follows, and so a failure here cannot be mistaken for a hung turn.
    await runByClick(browser, "/stop");
    await waitForIdle(browser, TIMEOUT);
  });
});
