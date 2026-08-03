// User-skill discovery, completion, invocation, and renderer-confidentiality flow.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { composerReadyOn, newAssistantChat } from "./flowSupport.mjs";

function skillMarkdown(name) {
  return `---
name: ${name}
description: Exercise live skill discovery and command completion
argument-hint: "[subject]"
allowed-tools: [listContainers]
---
PRIVATE E2E SKILL BODY. Return a short confirmation without calling tools.
`;
}

export async function skillDiscoveryFlow(driver) {
  const flowName = "skillDiscovery";
  await driver.goto("#/screens/ai/assistant");
  await driver.waitFor(composerReadyOn, "ai.assistant", { timeout: 20000, message: "assistant composer" });
  await newAssistantChat(driver);

  const root = await driver.evaluate(async () => (await window.AI.getSkills()).user.root);
  if (!root || path.basename(root) !== "ai-skills") {
    return { name: flowName, ok: false, detail: `unsafe skill root: ${String(root)}` };
  }
  const name = `e2e-skill-${Date.now().toString(36)}`;
  const skillDir = path.join(root, name);
  await mkdir(skillDir);
  await writeFile(path.join(skillDir, "SKILL.md"), skillMarkdown(name), { encoding: "utf8", flag: "wx" });

  let result;
  try {
    await driver.waitFor(
      async (skillId) => (await window.AI.getSkills()).skills.some((skill) => skill.id === skillId),
      `skill:user:${name}`,
      { timeout: 10000, message: "live skill discovery" },
    );
    await driver.evaluate(() => {
      const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
    await driver.typeText(`/skill:${name}`);
    await driver.waitFor(
      (command) =>
        [...document.querySelectorAll(".AssistantCommandPaletteCommand code")].some(
          (entry) => entry.textContent === command,
        ),
      `/skill:user:${name}`,
      { timeout: 5000, message: "dynamic skill completion" },
    );
    const expectedCompletion = `/skill:user:${name} `;
    await driver.press("Enter");
    await driver.waitFor(
      (value) =>
        document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.value === value &&
        !document.querySelector(".AssistantCommandPalette"),
      expectedCompletion,
      { timeout: 3000, message: "dynamic skill completion accepted" },
    );
    const completed = await driver.evaluate(() => {
      const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
      return {
        value: input?.value || "",
        selectionStart: input?.selectionStart,
        selectionEnd: input?.selectionEnd,
        focused: document.activeElement === input,
      };
    });
    await driver.typeText(" containers");
    await driver.press("Enter");

    const visibleCommand = `/skill:user:${name} containers`;
    await driver.waitFor(
      (command) =>
        [...document.querySelectorAll(".AssistantMessage--user")].some((message) =>
          (message.textContent || "").includes(command),
        ),
      visibleCommand,
      { timeout: 10000, message: "visible skill invocation" },
    );
    await driver.waitFor(
      () =>
        [...document.querySelectorAll(".AssistantMessage--assistant")].some(
          (message) => (message.textContent || "").trim().length > 0,
        ),
      undefined,
      { timeout: 20000, message: "skill assistant reply" },
    );
    const projection = await driver.evaluate(
      (command) => ({
        visibleCommand: [...document.querySelectorAll(".AssistantMessage--user")].some((message) =>
          (message.textContent || "").includes(command),
        ),
        leakedBody: (document.querySelector(".AppScreen")?.textContent || "").includes("PRIVATE E2E SKILL BODY"),
      }),
      visibleCommand,
    );
    await driver.screenshot("./webdriver/artifacts/ai-skill-discovery.png");
    const ok =
      completed.value === expectedCompletion &&
      completed.selectionStart === expectedCompletion.length &&
      completed.selectionEnd === expectedCompletion.length &&
      completed.focused &&
      projection.visibleCommand &&
      !projection.leakedBody;
    result = {
      name: flowName,
      ok,
      detail: ok
        ? "watched, completed, invoked, and projected without exposing skill instructions"
        : JSON.stringify({ completed, projection }),
    };
  } finally {
    await rm(skillDir, { recursive: true, force: true });
    await driver.waitFor(
      async (skillId) => !(await window.AI.getSkills()).skills.some((skill) => skill.id === skillId),
      `skill:user:${name}`,
      { timeout: 10000, message: "live skill removal" },
    );
  }
  return result;
}
