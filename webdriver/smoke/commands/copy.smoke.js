// SCENARIO — `/copy` : copies the last Assistant response
//
// `/copy` has a guard before it has an effect: with nothing answered yet there is nothing to copy, and the command
// says so instead of putting an empty string on the clipboard. That half is deterministic and is asserted exactly.
//
// The other half cannot be asserted the same way, and pretending otherwise would be the dishonest part of this file.
// WebKitWebDriver may refuse clipboard access to the automated session, and whether it does is a property of the
// driver, not of the app. So after a real answer the claim is narrower and still meaningful: `/copy` no longer says
// there is nothing to copy — it saw the response — and whatever it reports is one of the two outcomes the handler can
// legitimately produce. A test that demanded the success toast would fail on a machine where the driver said no, and
// that failure would be about WebKit, not about the command.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  collectNotifications,
  collectedNotifications,
  commandScenarioReason,
  composerHint,
  openAssistant,
  runByClick,
  runByTyping,
  stopSession,
  waitForIdle,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

const NOTHING_TO_COPY = "There is no Assistant response to copy";
const NO_CLIPBOARD = "Clipboard access is unavailable";

describe("/copy — copies the last Assistant response", () => {
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

  it("refuses, and says why, before anything has been answered", async () => {
    await runByClick(browser, "/copy");
    await browser.waitUntil(async () => (await composerHint(browser)).includes(NOTHING_TO_COPY), {
      timeout: TIMEOUT,
      interval: 250,
      timeoutMsg: `/copy did not report "${NOTHING_TO_COPY}" on an unanswered session`,
    });
  });

  it("sees the response once there is one", async () => {
    await runByTyping(browser, "Reply with exactly: ok");
    await $(".AssistantMessage--assistant").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "the Assistant never answered, so /copy has nothing to see",
    });
    await waitForIdle(browser, TIMEOUT);

    await collectNotifications(browser);
    await runByClick(browser, "/copy");
    await browser.pause(1500);
    const hint = await composerHint(browser);
    const toasts = await collectedNotifications(browser);

    assert.ok(
      !hint.includes(NOTHING_TO_COPY),
      "/copy still reported nothing to copy after the Assistant had answered",
    );
    const copied = toasts.some((text) => /copied/i.test(text));
    assert.ok(
      copied || hint.includes(NO_CLIPBOARD),
      `/copy neither copied nor explained itself — hint: "${hint}", notifications: ${JSON.stringify(toasts)}`,
    );
  });
});
