import {
  closeOpenAppDrawer,
  composerReadyOn,
  newAssistantChat,
  sendEnabledOn,
  submitComposer,
} from "./flowSupport.mjs";

async function executeCommand(driver, command, drawerSelector) {
  await driver.evaluate(() => document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.focus());
  await driver.typeText(command);
  await driver.waitFor(() => !!document.querySelector(".AssistantCommandPalette"), undefined, {
    timeout: 3000,
    message: `${command} completion`,
  });
  await driver.press("Enter");
  await driver.waitFor(() => !document.querySelector(".AssistantCommandPalette"), undefined, {
    timeout: 3000,
    message: `${command} completion accepted`,
  });
  await driver.press("Enter");
  await driver.waitFor((selector) => !!document.querySelector(selector), drawerSelector, {
    timeout: 5000,
    message: `${command} drawer`,
  });
}

/** @param {import("./flowSupport.mjs").AiE2eDriver} driver */
export async function contextDiagnosticsFlow(driver) {
  const flowName = "contextDiagnostics";
  const marker = `CONTEXT-E2E-${Date.now()}`;
  await driver.goto("#/screens/ai/assistant");
  await driver.waitFor(composerReadyOn, "ai.assistant", { timeout: 20000, message: "assistant composer" });
  await newAssistantChat(driver);
  await driver.evaluate(submitComposer, { text: marker, screenId: "ai.assistant" });
  await driver.waitFor(sendEnabledOn, "ai.assistant", { timeout: 3000, message: "context message ready" });
  await driver.evaluate(() => document.querySelector('[data-screen="ai.assistant"] .AIComposerSend')?.click());
  await driver.waitFor((text) => document.querySelector(".AssistantTranscript")?.textContent?.includes(text), marker, {
    timeout: 10000,
    message: "context message projected",
  });
  await driver.waitFor(() => !document.querySelector('[data-screen="ai.assistant"] .AIComposerStop'), undefined, {
    timeout: 15000,
    message: "context turn complete",
  });

  await executeCommand(driver, "/tokens", '[data-testid="assistant-context-drawer"]');
  const context = await driver.evaluate(() => ({
    requests: document.querySelector(".AssistantContextStats")?.textContent || "",
    sections: document.querySelectorAll(".AssistantContextRow").length,
    buttons: [...document.querySelectorAll('[data-testid="assistant-context-drawer"] button')].map(
      (button) => button.textContent,
    ),
  }));
  if (!context.requests.includes("1") || context.sections === 0 || !context.buttons.includes("Tools")) {
    return { name: flowName, ok: false, detail: `context drawer: ${JSON.stringify(context)}` };
  }
  await driver.evaluate(() => {
    const tools = [...document.querySelectorAll('[data-testid="assistant-context-drawer"] button')].find(
      (button) => button.textContent === "Tools",
    );
    tools?.click();
  });
  await driver.waitFor(() => document.querySelectorAll(".AssistantToolRow").length > 0, undefined, {
    timeout: 3000,
    message: "effective tool catalogue",
  });
  const toolCount = await driver.evaluate(() => document.querySelectorAll(".AssistantToolRow").length);
  await closeOpenAppDrawer(driver);

  await executeCommand(driver, "/doctor", '[data-testid="assistant-diagnostics-drawer"]');
  await driver.waitFor(
    () => document.querySelector(".AssistantDiagnosticProvider")?.textContent?.includes("reachable"),
    undefined,
    { timeout: 5000, message: "AI provider diagnostics" },
  );
  const diagnostics = await driver.evaluate(() => ({
    text: document.querySelector('[data-testid="assistant-diagnostics-drawer"]')?.textContent || "",
    providerMessage: document.querySelector(".AssistantDiagnosticProvider")?.textContent || "",
  }));
  await driver.screenshot("./webdriver/artifacts/ai-context-diagnostics.png");
  const ok = diagnostics.text.includes("Host capabilities") && diagnostics.providerMessage.includes("reachable");
  return {
    name: flowName,
    ok,
    detail: ok ? `${toolCount} effective tools; provider reachable` : JSON.stringify(diagnostics),
  };
}

/** @param {import("./flowSupport.mjs").AiE2eDriver} driver */
export async function projectContextFlow(driver) {
  const flowName = "projectContext";
  const marker = `PROJECT-MEMORY-E2E-${Date.now()}`;
  let memoryId;
  await driver.goto("#/screens/ai/assistant");
  await driver.waitFor(composerReadyOn, "ai.assistant", { timeout: 20000, message: "assistant composer" });
  await closeOpenAppDrawer(driver);
  await newAssistantChat(driver);

  try {
    await executeCommand(driver, `/remember ${marker}`, '[data-testid="project-context-panel"]');
    const draft = await driver.evaluate(() => document.querySelector(".ProjectMemoryComposer textarea")?.value || "");
    const persistedBeforeReview = await driver.evaluate(
      (content) =>
        window.AI.getProjectContext().then(
          (snapshot) => snapshot.state === "ready" && snapshot.memory.some((entry) => entry.content === content),
        ),
      marker,
    );
    if (draft !== marker || persistedBeforeReview) {
      return {
        name: flowName,
        ok: false,
        detail: `review gate: ${JSON.stringify({ draft, persistedBeforeReview })}`,
      };
    }

    await driver.evaluate(() => document.querySelector(".ProjectMemoryComposer button[type=submit]")?.click());
    await driver.waitFor(
      (content) =>
        [...document.querySelectorAll(".ProjectMemoryEntryBody p")].some((entry) => entry.textContent === content),
      marker,
      { timeout: 5000, message: "Project Memory persisted after review" },
    );
    memoryId = await driver.evaluate(
      (content) =>
        window.AI.getProjectContext().then((snapshot) =>
          snapshot.state === "ready" ? snapshot.memory.find((entry) => entry.content === content)?.id : undefined,
        ),
      marker,
    );

    await driver.evaluate(() =>
      [...document.querySelectorAll(".ProjectContextPanel > .bp6-button-group button")]
        .find((button) => button.textContent === "Preview")
        ?.click(),
    );
    await driver.waitFor(
      (content) =>
        [...document.querySelectorAll(".ProjectContextSourceList details")].some((row) =>
          row.textContent?.includes(content),
        ),
      marker,
      { timeout: 3000, message: "exact Project Context preview" },
    );
    const preview = await driver.evaluate(() => ({
      stats: document.querySelector(".ProjectContextStats")?.textContent || "",
      taint: document.querySelector(".ProjectContextStack .bp6-callout")?.textContent || "",
      fingerprint: document.querySelector(".ProjectContextCard header .bp6-tag")?.textContent || "",
    }));

    await driver.evaluate(() =>
      [...document.querySelectorAll(".ProjectContextPanel > .bp6-button-group button")]
        .find((button) => button.textContent === "Rules")
        ?.click(),
    );
    const rules = await driver.evaluate(() => ({
      enabled: document.querySelector(".ProjectRulesControl input")?.checked,
      count: document.querySelectorAll(".ProjectRuleList > div").length,
      text: document.querySelector(".ProjectRulesControl")?.textContent || "",
    }));
    await driver.screenshot("./webdriver/artifacts/ai-project-context.png");
    const ok =
      !!memoryId &&
      preview.stats.includes("48 KiB") &&
      preview.taint.includes("initially taints") &&
      preview.fingerprint.length > 0 &&
      rules.enabled === false &&
      rules.text.includes("cannot grant tools");
    return {
      name: flowName,
      ok,
      detail: ok ? `${rules.count} rule files; exact tainted pack previewed` : JSON.stringify({ preview, rules }),
    };
  } finally {
    if (memoryId) {
      await driver.evaluate((id) => window.AI.removeProjectMemory(id), memoryId);
    }
    await closeOpenAppDrawer(driver);
  }
}
