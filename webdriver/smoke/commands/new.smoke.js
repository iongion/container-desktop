// SCENARIO — `/new` : starts a fresh conversation
//
// A pi session IS the conversation, so pi's `/new` means a fresh one on the same settings. The proof has to be a
// transcript that HAD something in it and then does not — asserting an empty transcript on a session that never said
// anything would pass without `/new` existing at all.
//
// Nothing here is destructive of anything the user owns: a new conversation is added, and pi keeps its sessions in the
// named volume rather than the container, so the previous one is still on disk afterwards.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  commandScenarioReason,
  openAssistant,
  runByClick,
  runByTyping,
  stopSession,
  waitForIdle,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

function messageCount(browser) {
  return browser.execute(() => document.querySelectorAll(".AssistantMessage").length);
}

describe("/new — starts a fresh conversation", () => {
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

  it("empties a transcript that had something in it", async () => {
    // Short on purpose: the turn only has to leave a message behind, and `/new` is a queued command that would
    // otherwise wait for it.
    await runByTyping(browser, "Reply with exactly: ok");
    await $(".AssistantMessage").waitForExist({ timeout: TIMEOUT, timeoutMsg: "the message never reached the transcript" });
    await waitForIdle(browser, TIMEOUT);
    assert.ok((await messageCount(browser)) > 0, "the transcript was empty before /new, so emptying it proves nothing");

    await runByClick(browser, "/new");
    await $(".AssistantEmpty").waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "/new left the previous conversation on screen",
    });
    assert.equal(await messageCount(browser), 0, "/new left messages in the transcript");
  });
});
