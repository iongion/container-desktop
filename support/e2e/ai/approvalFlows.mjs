// Assistant approval and rejection flows.
import { composerReadyOn, newAssistantChat, sendEnabledOn, submitComposer } from "./flowSupport.mjs";

async function ensureAskMode(driver) {
  const modeLabels = ["Always ask", "Ask and remember", "Always allow"];
  const opened = await driver.evaluate((labels) => {
    const button = [...document.querySelectorAll('[data-screen="ai.assistant"] .AIComposerTool')].find((b) =>
      labels.some((label) => (b.textContent || "").includes(label)),
    );
    if (!button || button.disabled) return false;
    if ((button.textContent || "").includes("Always ask")) return false; // already ask — do not re-write settings
    button.click();
    return true;
  }, modeLabels);
  if (!opened) return;
  await driver.waitFor(() => !!document.querySelector(".AIComposerModeMenu a.bp6-menu-item"), undefined, {
    timeout: 8000,
    message: "permission-mode menu",
  });
  await driver.evaluate(() => {
    const item = [...document.querySelectorAll(".AIComposerModeMenu a.bp6-menu-item")].find((a) =>
      (a.textContent || "").includes("Always ask"),
    );
    if (item) item.click();
  });
  // The popover closes on select; make sure it is gone before the flow submits.
  await driver.waitFor(() => !document.querySelector(".AIComposerModeMenu"), undefined, {
    timeout: 8000,
    message: "mode menu closed",
  });
}

// Submit one assistant message through the real composer (native value setter + Send click), waiting for the
// model to be discovered so Send is enabled — mirrors chatFlow. Returns false if the composer was not ready.
async function submitAssistant(driver, text) {
  // Wait for any prior turn to settle first: the composer accepts a mid-stream submit as STEERING, so submitting
  // while the previous scenario's reply still streams would interrupt it instead of starting a fresh gated turn.
  await driver.waitFor(() => !document.querySelector('[data-screen="ai.assistant"] .AIComposerStop'), undefined, {
    timeout: 20000,
    message: "assistant idle before submit",
  });
  const submitted = await driver.evaluate(submitComposer, { text, screenId: "ai.assistant" });
  if (!submitted?.ok) return false;
  await driver.waitFor(sendEnabledOn, "ai.assistant", { timeout: 12000, message: "assistant send enabled" });
  await driver.evaluate(() => document.querySelector('[data-screen="ai.assistant"] .AIComposerSend').click());
  return true;
}

// Wait for a pending approval card whose <label> button is ENABLED, then click it. The Allow/Reject buttons render
// `loading` (disabled) until the session's phase is awaiting-approval, so clicking the instant the card mounts is a
// no-op that leaves the card stuck — gating on `!disabled` is what makes the resolve reliable.
async function clickPendingApproval(driver, label) {
  await driver.waitFor(
    (wanted) =>
      [...document.querySelectorAll(".AssistantApproval .AssistantApprovalActions button")].some(
        (b) => (b.textContent || "").includes(wanted) && !b.disabled,
      ),
    label,
    { timeout: 20000, message: `enabled ${label} button` },
  );
  await driver.evaluate((wanted) => {
    const button = [...document.querySelectorAll(".AssistantApproval .AssistantApprovalActions button")].find(
      (b) => (b.textContent || "").includes(wanted) && !b.disabled,
    );
    if (button) button.click();
  }, label);
}

/**
 * Assistant permission-gated tool card — the Allow branch, the Reject branch, AND the multi-approval BATCH
 * invariant (allowing the first of two must NOT resume the run; only the last decision does). Drives the real
 * `.AssistantApproval` card the Assistant surfaces in Always-ask mode. The mock scripts the tool calls:
 * "restart the web container" → one gated call; "remove … container" → a destructive gated call; "restart web
 * and cache" → two gated calls in one step. Re-runnable: each scenario is a fresh submit in the same session.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function assistantApprovalFlow(driver) {
  await driver.goto("#/screens/ai/assistant");
  await driver.waitFor(composerReadyOn, "ai.assistant", { timeout: 20000, message: "assistant composer" });
  await newAssistantChat(driver);
  await ensureAskMode(driver);

  // 1) Single gated tool → ALLOW → the card resolves (its actions give way to an Allowed tag) and the run goes on.
  if (!(await submitAssistant(driver, "restart the web container"))) {
    return { name: "assistantApproval", ok: false, detail: "composer not ready (allow)" };
  }
  await clickPendingApproval(driver, "Allow");
  await driver.waitFor(
    () => document.querySelectorAll(".AssistantApproval .AssistantApprovalActions").length === 0,
    undefined,
    {
      timeout: 20000,
      message: "approval resolved (allow)",
    },
  );

  // 2) Destructive gated tool → REJECT → the card declines (actions give way to a Declined tag).
  if (!(await submitAssistant(driver, "remove the web container"))) {
    return { name: "assistantApproval", ok: false, detail: "composer not ready (reject)" };
  }
  await clickPendingApproval(driver, "Reject");
  await driver.waitFor(
    () => document.querySelectorAll(".AssistantApproval .AssistantApprovalActions").length === 0,
    undefined,
    {
      timeout: 20000,
      message: "approval resolved (reject)",
    },
  );

  // 3) TWO gated calls in ONE model turn — the interactive engine gates them SEQUENTIALLY: one card, allow it and
  // its tool runs, THEN the next card appears. Baseline the card count so this is independent of scenarios 1-2.
  const base = await driver.evaluate(() => document.querySelectorAll(".AssistantApproval").length);
  if (!(await submitAssistant(driver, "restart web and cache"))) {
    return { name: "assistantApproval", ok: false, detail: "composer not ready (sequential)" };
  }
  await driver.waitFor((b) => document.querySelectorAll(".AssistantApproval").length === b + 1, base, {
    timeout: 20000,
    message: "first of two approvals",
  });
  await clickPendingApproval(driver, "Allow");
  // Allowing the first runs its tool; only THEN does the second gated call raise the next card.
  await driver.waitFor((b) => document.querySelectorAll(".AssistantApproval").length === b + 2, base, {
    timeout: 20000,
    message: "second approval after first allow",
  });
  const sequential = await driver.evaluate(
    () => document.querySelectorAll(".AssistantApproval .AssistantApprovalActions").length === 1,
  );
  await clickPendingApproval(driver, "Allow");
  await driver.waitFor(
    () => document.querySelectorAll(".AssistantApproval .AssistantApprovalActions").length === 0,
    undefined,
    { timeout: 20000, message: "both resolved after second allow" },
  );

  await driver.screenshot("./webdriver/artifacts/ai-assistant-approval.png");
  return {
    name: "assistantApproval",
    ok: sequential,
    detail: sequential
      ? "allow + reject branches drove the native card; two calls in one turn gated one-at-a-time (sequential)"
      : "expected exactly one pending card when the second gated call surfaced",
  };
}

/**
 * Enter-to-send — the composer submits on a bare Enter keydown (Shift+Enter is a newline), a handler every other
 * flow bypasses by clicking Send. Types a marker, dispatches a real Enter keydown, and asserts the message both
 * echoed AND cleared the draft (so Enter SENT, it did not merely insert a newline). Fresh chat for independence.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
