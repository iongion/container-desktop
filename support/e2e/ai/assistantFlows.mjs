// Assistant conversation, composer, completion, and Session-history flows.
import {
  closeOpenAppDrawer,
  composerReadyOn,
  newAssistantChat,
  screenText,
  sendEnabledOn,
  submitComposer,
} from "./flowSupport.mjs";

export async function chatFlow(driver) {
  await driver.goto("#/screens/ai/assistant");
  await driver.waitFor(composerReadyOn, "ai.assistant", { timeout: 20000, message: "assistant composer" });
  await newAssistantChat(driver);
  const marker = `E2E marker ${Date.now()}`;

  const submitted = await driver.evaluate(submitComposer, { text: marker, screenId: "ai.assistant" });
  if (!submitted?.ok) return { name: "chat", ok: false, detail: submitted?.reason || "submit failed" };
  await driver.waitFor(sendEnabledOn, "ai.assistant", { timeout: 8000, message: "chat send enabled" });
  await driver.evaluate(() => document.querySelector('[data-screen="ai.assistant"] .AIComposerSend').click());

  // The reducer projects the user message immediately, then the host streams an assistant reply which arrives as
  // chat-event envelopes and is projected in. Assert the echo, then that some assistant text follows it.
  await driver.waitFor((text) => (document.querySelector(".AppScreen")?.textContent || "").includes(text), marker, {
    timeout: 12000,
    message: "user message echoed",
  });
  // Wait for a real assistant-role bubble carrying streamed content — not merely "some text after the marker",
  // which UI chrome (the composer placeholder, starter chips) also satisfies.
  await driver.waitFor(
    () =>
      [...document.querySelectorAll(".AssistantMessage--assistant")].some(
        (m) => (m.textContent || "").trim().length > 0,
      ),
    undefined,
    { timeout: 20000, message: "assistant replied" },
  );
  const content = await driver.evaluate(screenText);
  // Beyond "some text followed the echo": assert the STRUCTURE the reducer projects — the marker lives in a
  // user-role bubble, and at least one assistant-role bubble was rendered. Role classes come from the timeline
  // reducer, so this catches a projection that drops the role even when raw text is present.
  const structure = await driver.evaluate((text) => {
    const inUserBubble = [...document.querySelectorAll(".AssistantMessage--user")].some((m) =>
      (m.textContent || "").includes(text),
    );
    const assistantBubbles = document.querySelectorAll(".AssistantMessage--assistant").length;
    return { inUserBubble, assistantBubbles };
  }, marker);
  await driver.screenshot("./webdriver/artifacts/ai-chat.png");
  const ok = content.includes(marker) && structure.inUserBubble && structure.assistantBubbles > 0;
  return {
    name: "chat",
    ok,
    detail: ok ? "user echoed in a user bubble + assistant replied in an assistant bubble" : JSON.stringify(structure),
  };
}

/**
 * Run mode: describe an outcome, approve the proposed plan, then let the agents run. This is the flow that
 * exercises the approval GATE — nothing may be dispatched until the plan is approved — plus the parallel
 * scheduler and the final synthesis, all through the same envelope protocol chat uses.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */

export async function composerEnterFlow(driver) {
  await driver.goto("#/screens/ai/assistant");
  await driver.waitFor(composerReadyOn, "ai.assistant", { timeout: 20000, message: "assistant composer" });
  await newAssistantChat(driver);

  const marker = `Enter marker ${Date.now()}`;
  const submitted = await driver.evaluate(submitComposer, { text: marker, screenId: "ai.assistant" });
  if (!submitted?.ok) return { name: "composerEnter", ok: false, detail: submitted?.reason || "no composer" };
  // Send enables once a model is discovered; canSubmit gates Enter on the same selection.model, so wait for it.
  await driver.waitFor(sendEnabledOn, "ai.assistant", { timeout: 12000, message: "send enabled" });
  await driver.evaluate(() => {
    const ta = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });

  await driver.waitFor((text) => (document.querySelector(".AppScreen")?.textContent || "").includes(text), marker, {
    timeout: 12000,
    message: "Enter-submitted message echoed",
  });
  await driver.waitFor(
    () => (document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.value || "") === "",
    undefined,
    { timeout: 8000, message: "draft cleared after Enter" },
  );
  await driver.screenshot("./webdriver/artifacts/ai-composer-enter.png");
  return { name: "composerEnter", ok: true, detail: "Enter submitted the message and cleared the draft" };
}

/**
 * Slash-command keyboard contract. Opens completion by typing `/`, verifies the composer retains focus while
 * filtering, moves selection with ArrowDown, narrows the results, and accepts completion with Enter. This must use
 * the shell keyboard driver: dispatching synthetic DOM events would miss focus traps in portal popovers.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function slashCommandKeyboardFlow(driver) {
  await driver.goto("#/screens/ai/assistant");
  await driver.waitFor(composerReadyOn, "ai.assistant", { timeout: 20000, message: "assistant composer" });
  await closeOpenAppDrawer(driver);
  await newAssistantChat(driver);
  await driver.evaluate(() => {
    const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });

  await driver.typeText("/");
  await driver.waitFor(() => !!document.querySelector(".AssistantCommandPalette"), undefined, {
    timeout: 3000,
    message: "slash-command palette",
  });
  const focusRetained = await driver.evaluate(
    () => document.activeElement === document.querySelector('[data-screen="ai.assistant"] .AIComposerInput'),
  );
  if (!focusRetained) return { name: "slashCommandKeyboard", ok: false, detail: "palette stole composer focus" };

  await driver.typeText("memory");
  await driver.waitFor(
    () => document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.value === "/memory",
    undefined,
    { timeout: 3000, message: "typed slash query" },
  );
  // `/memory` narrows to the four Project-context commands, so ArrowDown below has somewhere to move.
  await driver.waitFor(() => document.querySelectorAll(".AssistantCommandPaletteRow").length === 4, undefined, {
    timeout: 3000,
    message: "slash query narrowed to a navigable set",
  });
  await driver.waitFor(
    () => {
      const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
      const palette = document.querySelector(".AssistantCommandPalette");
      const inputRect = input?.getBoundingClientRect();
      const paletteRect = palette?.getBoundingClientRect();
      return !!inputRect && !!paletteRect && Math.abs(paletteRect.width - inputRect.width) <= 2;
    },
    undefined,
    { timeout: 3000, message: "slash palette input width" },
  );
  const typedAnchor = await driver.evaluate(() => {
    const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
    const palette = document.querySelector(".AssistantCommandPalette");
    const inputRect = input?.getBoundingClientRect();
    const paletteRect = palette?.getBoundingClientRect();
    return {
      anchor: palette?.getAttribute("data-command-anchor") || null,
      aboveInput: !!inputRect && !!paletteRect && paletteRect.bottom <= inputRect.top + 2,
      sameWidth: !!inputRect && !!paletteRect && Math.abs(paletteRect.width - inputRect.width) <= 2,
      textVisible: input?.value === "/memory",
    };
  });
  if (typedAnchor.anchor !== "input" || !typedAnchor.aboveInput || !typedAnchor.sameWidth || !typedAnchor.textVisible) {
    return { name: "slashCommandKeyboard", ok: false, detail: `typed anchor: ${JSON.stringify(typedAnchor)}` };
  }
  const before = await driver.evaluate(
    () => document.querySelector('.AssistantCommandPaletteRow[aria-selected="true"] code')?.textContent || "",
  );
  await driver.press("ArrowDown");
  const after = await driver.evaluate(
    () => document.querySelector('.AssistantCommandPaletteRow[aria-selected="true"] code')?.textContent || "",
  );

  await driver.typeText(" add");
  await driver.waitFor(() => document.querySelectorAll(".AssistantCommandPaletteRow").length === 1, undefined, {
    timeout: 3000,
    message: "filtered slash-command result",
  });
  const highlighted = await driver.evaluate(() => !!document.querySelector(".AssistantCommandPaletteCommand mark"));
  await driver.press("Enter");
  await driver.waitFor(() => !document.querySelector(".AssistantCommandPalette"), undefined, {
    timeout: 3000,
    message: "slash-command palette closed after completion",
  });
  const completed = await driver.evaluate(() => {
    const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
    return {
      value: input?.value || "",
      selectionStart: input?.selectionStart,
      selectionEnd: input?.selectionEnd,
      paletteOpen: !!document.querySelector(".AssistantCommandPalette"),
      focused: document.activeElement === input,
    };
  });
  await driver.evaluate(() => {
    const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await driver.waitFor(
    () => document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.value === "",
    undefined,
    { timeout: 3000, message: "composer cleared before button palette" },
  );
  await driver.evaluate(() => document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.focus());
  await driver.typeText("/memory rem");
  await driver.waitFor(() => document.querySelectorAll(".AssistantCommandPaletteRow").length === 1, undefined, {
    timeout: 3000,
    message: "Tab completion result",
  });
  await driver.press("Tab");
  await driver.waitFor(
    () => document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.value === "/memory remove ",
    undefined,
    { timeout: 3000, message: "Tab inserted command" },
  );
  const tabCompleted = await driver.evaluate(() => {
    const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
    return {
      value: input?.value || "",
      selectionStart: input?.selectionStart,
      selectionEnd: input?.selectionEnd,
      focused: document.activeElement === input,
    };
  });
  await driver.typeText("/worker");
  await driver.waitFor(
    () => document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.value === "/memory remove /worker",
    undefined,
    { timeout: 3000, message: "slash remains argument text after command completion" },
  );
  await driver.waitFor(() => !document.querySelector(".AssistantCommandPalette"), undefined, {
    timeout: 3000,
    message: "argument slash does not reopen completion",
  });
  const argumentSlashStayedText = await driver.evaluate(() => !document.querySelector(".AssistantCommandPalette"));
  await driver.evaluate(() => {
    const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await driver.waitFor(
    () =>
      document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.value === "" &&
      !document.querySelector(".AssistantCommandPalette"),
    undefined,
    { timeout: 3000, message: "composer settled before button palette" },
  );
  await driver.evaluate(() =>
    document.querySelector('[data-screen="ai.assistant"] .AIComposerCommandTrigger')?.click(),
  );
  await driver.waitFor(() => !!document.querySelector(".AssistantCommandPalette"), undefined, {
    timeout: 3000,
    message: "button slash-command palette",
  });
  const buttonAnchor = await driver.evaluate(
    () => document.querySelector(".AssistantCommandPalette")?.getAttribute("data-command-anchor") || null,
  );
  await driver.screenshot("./webdriver/artifacts/ai-slash-command-keyboard.png");
  await driver.press("Escape");
  await driver.waitFor(() => !document.querySelector(".AssistantCommandPalette"), undefined, {
    timeout: 3000,
    message: "close button slash-command palette",
  });

  const ok =
    before !== after &&
    highlighted &&
    completed.value === "/memory add " &&
    completed.selectionStart === completed.value.length &&
    completed.selectionEnd === completed.value.length &&
    !completed.paletteOpen &&
    completed.focused &&
    tabCompleted.selectionStart === tabCompleted.value.length &&
    tabCompleted.selectionEnd === tabCompleted.value.length &&
    tabCompleted.focused &&
    argumentSlashStayedText &&
    buttonAnchor === "button";
  return {
    name: "slashCommandKeyboard",
    ok,
    detail: ok
      ? "real keyboard retained focus, filtered, highlighted, navigated, and completed"
      : JSON.stringify({ before, after, highlighted, completed, tabCompleted, argumentSlashStayedText, buttonAnchor }),
  };
}

