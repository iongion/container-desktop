// SCENARIO — `/reload` : reloads the session's contributed resources
//
// `/reload` re-reads keybindings, extensions, skills, prompts, themes and context files. It is deliberately
// side-effect-free and opens nothing, so there is no drawer to point at — what CAN be asserted is that it was
// accepted and ran to completion rather than being refused, and that the skill library still answers afterwards.
//
// Honest limit: this does not prove the reload re-read anything. Proving that needs a resource changed on disk
// mid-session, which belongs with the extension specs that already own that fixture.
//
// Tier: a real app, an engine, the agent image and a resident model. Every scenario needs a session — see assistantCommands.js for why the palette cannot be reached without one.
import { strict as assert } from "node:assert";

import {
  TIMEOUT,
  closeAnyDrawer,
  commandScenarioReason,
  draftText,
  openAssistant,
  runByClick,
  stopSession,
} from "../../support/assistantCommands.js";
import { skipSuite } from "../../support/prerequisites.js";

describe("/reload — reloads the session's contributed resources", () => {
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

  it("is accepted and leaves the session usable", async () => {
    await runByClick(browser, "/reload");
    // A refusal surfaces as the composer's hint. Its absence is what "accepted" looks like here.
    await browser.pause(1000);
    const hint = await browser.execute(() => document.querySelector(".AIComposerHint")?.textContent ?? "");
    assert.ok(!/unavailable|cannot|failed/i.test(hint), `/reload was refused: ${hint}`);
    assert.ok(!(await draftText(browser)).includes("/reload"), "/reload was typed into the composer instead of run");

    // The skill library reads through the same registry the reload rebuilt, so it answering at all is the check
    // that the reload did not leave the session without one.
    await runByClick(browser, "/skills");
    await $(".AssistantSkillsDrawer").waitForExist({ timeout: TIMEOUT, timeoutMsg: "no skills after /reload" });
    await closeAnyDrawer(browser);
  });
});
