// Thread checkpoint and branching flows.
import { composerReadyOn, newAssistantChat, sendEnabledOn } from "./flowSupport.mjs";

function messageProjection() {
  return [...document.querySelectorAll('[data-screen="ai.assistant"] .AssistantMessage')].map((message) => ({
    role: message.classList.contains("AssistantMessage--user") ? "user" : "assistant",
    text: message.querySelector(".AssistantMessageContent")?.textContent?.trim() || "",
  }));
}

/**
 * Branches a settled Thread through the real slash-command keyboard path, checks the inherited transcript and
 * non-environment warning, then continues the branch with another turn.
 * @param {import("./flowSupport.mjs").AiE2eDriver} driver
 * @returns {Promise<import("./flowSupport.mjs").FlowResult>}
 */
export async function threadBranchFlow(driver) {
  await driver.goto("#/screens/ai/assistant");
  await driver.waitFor(composerReadyOn, "ai.assistant", { timeout: 20000, message: "assistant composer" });
  await newAssistantChat(driver);

  const marker = `Branch source ${Date.now()}`;
  await driver.evaluate(() => {
    const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
  await driver.typeText(marker);
  await driver.waitFor(sendEnabledOn, "ai.assistant", { timeout: 12000, message: "branch source send enabled" });
  await driver.press("Enter");
  await driver.waitFor(
    (text) =>
      [...document.querySelectorAll('[data-screen="ai.assistant"] .AssistantMessage--user')].some((message) =>
        (message.textContent || "").includes(text),
      ),
    marker,
    { timeout: 12000, message: "branch source message" },
  );
  await driver.waitFor(
    () =>
      [...document.querySelectorAll('[data-screen="ai.assistant"] .AssistantMessage--assistant')].some(
        (message) => (message.textContent || "").trim().length > 0,
      ),
    undefined,
    { timeout: 20000, message: "branch source response" },
  );
  await driver.waitFor(() => !document.querySelector('[data-screen="ai.assistant"] .AIComposerStop'), undefined, {
    timeout: 20000,
    message: "branch source settled",
  });
  await driver.waitFor(
    () => !!document.querySelector('[data-screen="ai.assistant"] .AssistantMessageBranch'),
    undefined,
    { timeout: 8000, message: "durable Thread checkpoint" },
  );
  const sourceMessages = await driver.evaluate(messageProjection);

  await driver.evaluate(() => document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.focus());
  await driver.typeText("/branch");
  await driver.waitFor(
    () => {
      const rows = [...document.querySelectorAll(".AssistantCommandPaletteRow")];
      return rows.length === 1 && (rows[0].textContent || "").includes("/thread branch");
    },
    undefined,
    { timeout: 3000, message: "branch slash completion" },
  );
  await driver.press("Enter");
  await driver.waitFor(
    () => document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.value === "/thread branch ",
    undefined,
    { timeout: 3000, message: "branch command inserted" },
  );
  await driver.press("Enter");
  await driver.waitFor(() => !!document.querySelector(".ThreadBranchDrawer"), undefined, {
    timeout: 5000,
    message: "Thread branch Drawer",
  });
  await driver.waitFor(
    () => document.querySelectorAll(".ThreadBranchDrawer #threadBranchCheckpoint option").length > 0,
    undefined,
    { timeout: 8000, message: "Thread branch checkpoints" },
  );

  const drawer = await driver.evaluate(() => ({
    checkpoint: document.querySelector(".ThreadBranchDrawer #threadBranchCheckpoint")?.value || "",
    bindings: document.querySelectorAll(".ThreadBranchDrawer .ThreadBranchBindings > div").length,
    warnsAboutExternalState: (document.querySelector(".ThreadBranchDrawer")?.textContent || "").includes(
      "external service state is not restored",
    ),
  }));
  const branchTitle = `Branch continuation ${Date.now()}`;
  await driver.evaluate((title) => {
    const input = document.querySelector(".ThreadBranchDrawer #threadBranchTitle");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, branchTitle);
  await driver.evaluate(() => document.querySelector('.ThreadBranchDrawer button[type="submit"]')?.click());
  await driver.waitFor(() => !document.querySelector(".ThreadBranchDrawer"), undefined, {
    timeout: 8000,
    message: "Thread branch created",
  });
  await driver.waitFor(
    (title) =>
      document.querySelector('[data-screen="ai.assistant"] .ThreadSelectorTitle')?.textContent?.trim() === title,
    branchTitle,
    { timeout: 5000, message: "branched Thread selected" },
  );
  const inheritedMessages = await driver.evaluate(messageProjection);

  const continuation = `Continue branch ${Date.now()}`;
  await driver.evaluate(() => document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.focus());
  await driver.typeText(continuation);
  await driver.press("Enter");
  await driver.waitFor(
    (text) =>
      [...document.querySelectorAll('[data-screen="ai.assistant"] .AssistantMessage--user')].some((message) =>
        (message.textContent || "").includes(text),
      ),
    continuation,
    { timeout: 12000, message: "branch continuation message" },
  );
  await driver.waitFor(
    (count) => document.querySelectorAll('[data-screen="ai.assistant"] .AssistantMessage--assistant').length > count,
    sourceMessages.filter(({ role }) => role === "assistant").length,
    { timeout: 20000, message: "branch continuation response" },
  );
  await driver.waitFor(() => !document.querySelector('[data-screen="ai.assistant"] .AIComposerStop'), undefined, {
    timeout: 20000,
    message: "branch continuation settled",
  });
  await driver.screenshot("./webdriver/artifacts/ai-thread-branch.png");

  const inherited = JSON.stringify(inheritedMessages) === JSON.stringify(sourceMessages);
  const ok = !!drawer.checkpoint && drawer.bindings === 5 && drawer.warnsAboutExternalState && inherited;
  return {
    name: "threadBranch",
    ok,
    detail: ok
      ? "keyboard command branched a checkpoint, preserved its transcript, and continued independently"
      : JSON.stringify({ drawer, inherited, sourceMessages, inheritedMessages }),
  };
}
