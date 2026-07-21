// Backend-agnostic AI end-to-end flows. Each flow drives the real running app through an `AiE2eDriver` port and
// asserts an observable behavior — so the SAME flow runs on either shell: Playwright/CDP (Electron) or
// WebdriverIO/W3C-WebDriver (Tauri). These formalize the manual CDP checks used to verify the XState→robot3/closure
// AI-subsystem rewrite: a chat message is echoed and answered by the assistant, a goal run is planned/approved/run,
// and the workers library round-trips. All page logic lives in self-contained `evaluate`/`waitFor` functions (identical
// serialized JS on both engines); the driver supplies only navigation, evaluation, waiting, and screenshots.
//
// @typedef {Object} AiE2eDriver
// @property {(hashRoute: string) => Promise<void>} goto           Navigate the renderer to a `#/...` hash route.
// @property {(fn: Function, arg?: any) => Promise<any>} evaluate  Run a self-contained function in the page, return its value.
// @property {(fn: Function, arg?: any, opts?: {timeout?: number, message?: string}) => Promise<void>} waitFor  Poll a page predicate until truthy.
// @property {(path: string) => Promise<void>} screenshot         Write a viewport PNG (best-effort; may no-op).
// @property {() => Promise<void>} close                          Detach/teardown the driver.
//
// @typedef {{ name: string, ok: boolean, detail: string }} FlowResult

// Set the Blueprint composer's controlled textarea (via the native value setter so React's onChange fires) and
// press its Send button. Returned as a string of the function so both drivers serialize identical page JS.
function submitComposer(arg) {
  const { text, screenId } = arg;
  const ta = document.querySelector(`[data-screen="${screenId}"] .AIComposerInput`);
  if (!ta) return { ok: false, reason: "no composer textarea" };
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return { ok: true };
}

// Readiness MUST be scoped to the screen under test. Several AI screens render an <AIComposer>, so an
// unscoped ".AIComposerInput" check is satisfied by whichever screen the previous flow left mounted — the flow
// would then type into that one and wait forever for its marker to appear on the screen it meant to drive.
const composerReadyOn = (screenId) => !!document.querySelector(`[data-screen="${screenId}"] .AIComposerInput`);
const sendEnabledOn = (screenId) => {
  const button = document.querySelector(`[data-screen="${screenId}"] .AIComposerSend`);
  return !!button && !button.disabled;
};
const screenText = () => document.querySelector(".AppScreen")?.textContent || "";

/** @param {AiE2eDriver} driver @returns {Promise<FlowResult>} */
export async function chatFlow(driver) {
  await driver.goto("#/screens/ai/assistant");
  await driver.waitFor(composerReadyOn, "ai.assistant", { timeout: 20000, message: "assistant composer" });
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
  await driver.waitFor(
    (text) => {
      const content = document.querySelector(".AppScreen")?.textContent || "";
      const at = content.indexOf(text);
      return at >= 0 && content.slice(at + text.length).trim().length > 0;
    },
    marker,
    { timeout: 20000, message: "assistant replied" },
  );
  const content = await driver.evaluate(screenText);
  await driver.screenshot("./webdriver/artifacts/ai-chat.png");
  const ok = content.includes(marker);
  return { name: "chat", ok, detail: ok ? "user echoed + assistant replied" : "no echo/reply" };
}

/**
 * Goal mode: describe an outcome, approve the proposed plan, then let the agents run. This is the flow that
 * exercises the approval GATE — nothing may be dispatched until the plan is approved — plus the parallel
 * scheduler and the final synthesis, all through the same envelope protocol chat uses.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function goalFlow(driver) {
  // Goals are a LIST now: the run is created from the list's drawer, then opened as its own route. Walking
  // list -> create -> run is the point — it is the path a user actually takes.
  await driver.goto("#/screens/ai/goals");
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.goals"]'), undefined, {
    timeout: 20000,
    message: "goals list",
  });

  await driver.evaluate(() => {
    const create = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("New goal"));
    if (create) create.click();
  });
  await driver.waitFor(() => !!document.querySelector(".GoalCreateInput"), undefined, {
    timeout: 20000,
    message: "goal create drawer",
  });

  const submitted = await driver.evaluate((text) => {
    const ta = document.querySelector(".GoalCreateInput");
    if (!ta) return { ok: false, reason: "no goal textarea" };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  }, "Audit my running containers and tell me what to fix first.");
  if (!submitted?.ok) return { name: "goal", ok: false, detail: submitted?.reason || "submit failed" };

  await driver.evaluate(() => {
    const run = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Run goal"));
    if (run) run.click();
  });

  // Starting navigates to the run's own route; the plan gate belongs to that screen.
  await driver.waitFor(() => !!document.querySelector(".GoalPlanGate"), undefined, {
    timeout: 30000,
    message: "plan gate",
  });
  // The gate must hold: no task may report as started while the plan is still awaiting approval.
  const dispatchedEarly = await driver.evaluate(
    () => !![...document.querySelectorAll(".GoalTask")].find((t) => t.dataset.status === "running"),
  );
  if (dispatchedEarly) return { name: "goal", ok: false, detail: "a task ran before the plan was approved" };

  await driver.evaluate(() => {
    const approve = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Approve plan"));
    if (approve) approve.click();
  });

  // A gated tool raises an approval prompt mid-run; allow it so the run can finish.
  await driver.waitFor(
    () => !!document.querySelector(".GoalApproval") || !!document.querySelector(".GoalSynthesis"),
    undefined,
    { timeout: 40000, message: "tool approval or synthesis" },
  );
  await driver.evaluate(() => {
    const allow = [...document.querySelectorAll(".GoalApproval button")].find((b) =>
      (b.textContent || "").includes("Allow"),
    );
    if (allow) allow.click();
  });

  await driver.waitFor(() => !!document.querySelector(".GoalSynthesis"), undefined, {
    timeout: 60000,
    message: "synthesis",
  });
  const summary = await driver.evaluate(() => ({
    statuses: [...document.querySelectorAll(".GoalTask")].map((t) => t.dataset.status),
    synthesis: (document.querySelector(".GoalSynthesisBody")?.textContent || "").trim().slice(0, 80),
  }));
  await driver.screenshot("./webdriver/artifacts/ai-goal.png");
  const ok = summary.statuses.length > 0 && summary.statuses.every((s) => s !== "pending") && !!summary.synthesis;
  return {
    name: "goal",
    ok,
    detail: ok ? `plan gated, ${summary.statuses.length} tasks settled, answer rendered` : JSON.stringify(summary),
  };
}

/**
 * Workers library CRUD: create a worker through the editor drawer, see it listed, then remove it. Exercises the
 * broker's ai:workers channels and the file store round-trip — and asserts the tool-policy control actually
 * governs the checkbox grid, which is the security-bearing part of the editor.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function workersFlow(driver) {
  const name = `e2e-inspector-${Date.now()}`;
  await driver.goto("#/screens/ai/workers");
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.workers"]'), undefined, {
    timeout: 20000,
    message: "workers list",
  });

  await driver.evaluate(() => {
    const create = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create"));
    if (create) create.click();
  });
  await driver.waitFor(() => !!document.querySelector("#workerName"), undefined, {
    timeout: 20000,
    message: "worker editor",
  });

  await driver.evaluate((workerName) => {
    const input = document.querySelector("#workerName");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, workerName);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);

  // "All allowed" must check AND lock every tool — the mode is the grant, not a starting point to edit.
  const policyLocked = await driver.evaluate(() => {
    const all = [...document.querySelectorAll(".WorkerEditorPolicy button")].find((b) =>
      (b.textContent || "").includes("All allowed"),
    );
    if (!all) return { ok: false, reason: "no policy control" };
    all.click();
    const boxes = [...document.querySelectorAll(".WorkerEditorTool input")];
    return {
      ok: boxes.length > 0 && boxes.every((b) => b.checked && b.disabled),
      reason: `${boxes.length} tools, ${boxes.filter((b) => b.checked && b.disabled).length} checked+locked`,
    };
  });
  if (!policyLocked?.ok) {
    return { name: "workers", ok: false, detail: `all-allowed did not lock the grid: ${policyLocked?.reason}` };
  }

  await driver.evaluate(() => {
    const save = [...document.querySelectorAll("form button[type=submit]")].find((b) =>
      (b.textContent || "").includes("Create"),
    );
    if (save) save.click();
  });

  const listed = await driver.waitFor(
    (workerName) => [...document.querySelectorAll("td")].some((td) => (td.textContent || "").includes(workerName)),
    name,
    { timeout: 20000, message: "worker listed" },
  );
  await driver.screenshot("./webdriver/artifacts/ai-workers.png");
  if (!listed) return { name: "workers", ok: false, detail: "worker did not appear in the list" };

  // Round-trip it back out so the flow leaves no state behind for the next run.
  const removed = await driver.evaluate(async (workerName) => {
    const before = (await window.AI.listWorkers()).workers;
    const mine = before.find((w) => w.name === workerName);
    if (!mine) return { ok: false, reason: "not in the store" };
    const after = (await window.AI.removeWorker(mine.id)).workers;
    return { ok: !after.some((w) => w.id === mine.id), reason: `${before.length} -> ${after.length}` };
  }, name);

  const ok = !!removed?.ok;
  return { name: "workers", ok, detail: ok ? `created, listed and removed (${removed.reason})` : removed?.reason };
}

export const AI_FLOWS = [chatFlow, goalFlow, workersFlow];

/** Run all flows against a driver, returning results. @param {AiE2eDriver} driver */
export async function runAiFlows(driver) {
  const results = [];
  for (const flow of AI_FLOWS) {
    try {
      results.push(await flow(driver));
    } catch (error) {
      results.push({ name: flow.name, ok: false, detail: `threw: ${error?.message || error}` });
    }
  }
  return results;
}
