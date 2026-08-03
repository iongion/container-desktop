// Team Run and Assistant approval, rejection, transcript, and stop flows.
import { composerReadyOn, newAssistantChat, sendEnabledOn, submitComposer } from "./flowSupport.mjs";

const runScreenMounted = () => !!document.querySelector('[data-screen="ai.run"] .RunBar');

// Start a fresh run from the list drawer so rejection and stop flows remain re-runnable in one app session.
async function startRunToPlanGate(driver, goalText) {
  await driver.goto("#/screens/ai/runs");
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.runs"]'), undefined, {
    timeout: 20000,
    message: "runs list",
  });
  await driver.evaluate(() => {
    const create = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("New run"));
    if (create) create.click();
  });
  await driver.waitFor(() => !!document.querySelector(".RunCreateInput"), undefined, {
    timeout: 20000,
    message: "run create drawer",
  });
  await driver.evaluate((text) => {
    const ta = document.querySelector(".RunCreateInput");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, goalText);
  await driver.evaluate(() => {
    const run = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Start run"));
    if (run) run.click();
  });
  await driver.waitFor(() => !!document.querySelector(".RunPlanGate"), undefined, {
    timeout: 30000,
    message: "plan gate",
  });
}

const clickApprovePlan = (driver) =>
  driver.evaluate(() => {
    const approve = [...document.querySelectorAll(".RunPlanGateActions button")].find((b) =>
      (b.textContent || "").includes("Approve plan"),
    );
    if (approve) approve.click();
  });

// Drive the plan-gate Reject → "Reject plan" → Yes confirm (portaled popover). Shared by planRejectFlow.
async function confirmRejectPlan(driver) {
  await driver.evaluate(() => {
    // Exact match: the gate's trigger reads "Reject", the menu item it opens reads "Reject plan" — a substring
    // match would be order-dependent between the two.
    const reject = [...document.querySelectorAll(".RunPlanGateActions button")].find(
      (b) => (b.textContent || "").trim() === "Reject",
    );
    if (reject) reject.click();
  });
  await driver.waitFor(() => !!document.querySelector(".bp6-popover-content"), undefined, {
    timeout: 8000,
    message: "reject popover",
  });
  await driver.evaluate(() => {
    const item = document.querySelector(".bp6-popover-content a.bp6-menu-item");
    if (item) item.click();
  });
  await driver.waitFor(
    () =>
      [...document.querySelectorAll(".bp6-popover-content button")].some((b) => (b.textContent || "").trim() === "Yes"),
    undefined,
    { timeout: 8000, message: "yes/no confirm" },
  );
  await driver.evaluate(() => {
    const yes = [...document.querySelectorAll(".bp6-popover-content button")].find(
      (b) => (b.textContent || "").trim() === "Yes",
    );
    if (yes) yes.click();
  });
}

/**
 * Plan gate — the REJECT branch (runFlow covers Approve). Rejecting must settle the run without dispatching any
 * task, and it is gated behind the shared Yes/No ConfirmMenu, so the flow drives Reject → "Reject plan" → Yes.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function planRejectFlow(driver) {
  await startRunToPlanGate(driver, "Reject this plan: list my containers and stop.");
  const gateBefore = await driver.evaluate(() => !!document.querySelector(".RunPlanGate"));
  if (!gateBefore) return { name: "planReject", ok: false, detail: "no plan gate to reject" };

  await confirmRejectPlan(driver);

  // Rejecting settles the run: the gate is gone and nothing ever ran.
  await driver.waitFor(() => !document.querySelector(".RunPlanGate"), undefined, {
    timeout: 12000,
    message: "gate cleared",
  });
  const result = await driver.evaluate(() => ({
    phase: (document.querySelector('[data-screen="ai.run"] .RunPhase')?.textContent || "").trim(),
    ranAnyTask: [...document.querySelectorAll(".RunTask")].some((t) => t.dataset.status === "running"),
  }));
  await driver.screenshot("./webdriver/artifacts/ai-run-reject.png");
  const ok = !result.ranAnyTask;
  return {
    name: "planReject",
    ok,
    detail: ok ? `plan rejected, run settled (${result.phase}), no task dispatched` : JSON.stringify(result),
  };
}

/**
 * Tool approval — the REJECT branch (runFlow covers Allow). Approve the plan so a worker runs, then when it raises
 * a gated tool call, REJECT it: the prompt must clear (resolving it drops it from the pending list). Creates its own
 * run so it is re-runnable.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function toolRejectFlow(driver) {
  await startRunToPlanGate(driver, "Reject the tool: audit my running containers.");
  await clickApprovePlan(driver);

  await driver.waitFor(() => !!document.querySelector(".RunApproval"), undefined, {
    timeout: 40000,
    message: "tool approval",
  });
  const before = await driver.evaluate(() => document.querySelectorAll(".RunApproval").length);

  await driver.evaluate(() => {
    const reject = [...document.querySelectorAll(".RunApproval button")].find(
      (b) => (b.textContent || "").trim() === "Reject",
    );
    if (reject) reject.click();
  });

  // Resolving drops that prompt from the pending list. `before` is passed as an arg — the predicate runs in the
  // page and can't close over a Node-side variable.
  await driver.waitFor((prev) => document.querySelectorAll(".RunApproval").length < prev, before, {
    timeout: 12000,
    message: "approval cleared",
  });
  await driver.screenshot("./webdriver/artifacts/ai-tool-reject.png");
  const ok = before > 0;
  return {
    name: "toolReject",
    ok,
    detail: ok
      ? `rejected a queued tool approval (${before} pending), prompt cleared`
      : "no pending approval to reject",
  };
}

/**
 * Task graph transcript — clicking a node shows THAT agent's output, and a not-yet-started node shows the waiting
 * placeholder instead. Both halves the owner called out, driven against `mock-run-running` (a complete task with
 * output and a pending task with none). Read-only: it selects nodes, it does not mutate the run.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function taskTranscriptFlow(driver) {
  await driver.goto("#/screens/ai/run/mock-run-running");
  await driver.waitFor(runScreenMounted, undefined, { timeout: 20000, message: "run screen" });
  await driver.evaluate(() => {
    const dag = [...document.querySelectorAll(".RunViewMode button")].find((button) =>
      (button.textContent || "").includes("DAG"),
    );
    if (dag) dag.click();
  });
  await driver.waitFor(() => document.querySelectorAll(".RunTask").length > 0, undefined, {
    timeout: 20000,
    message: "task graph",
  });

  const clickStatus = (status) => {
    const node = [...document.querySelectorAll(".RunTask")].find((t) => t.dataset.status === status);
    if (node) {
      (node.closest(".react-flow__node") || node).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
      );
    }
    return !!node;
  };
  const transcript = () => (document.querySelector(".RunTranscriptBody")?.textContent || "").trim();

  const completeClicked = await driver.evaluate(clickStatus, "complete");
  await driver.waitFor(() => (document.querySelector(".RunTranscriptBody")?.textContent || "").trim().length > 0);
  const completeText = await driver.evaluate(transcript);

  const pendingClicked = await driver.evaluate(clickStatus, "pending");
  await driver.waitFor(() => !!document.querySelector(".RunTranscriptWaiting"), undefined, {
    timeout: 8000,
    message: "waiting placeholder",
  });
  const pendingText = await driver.evaluate(transcript);
  const pendingWaiting = await driver.evaluate(() => !!document.querySelector(".RunTranscriptWaiting"));

  await driver.screenshot("./webdriver/artifacts/ai-task-transcript.png");
  const ok = completeClicked && pendingClicked && completeText.length > 0 && pendingWaiting && pendingText.length > 0;
  return {
    name: "taskTranscript",
    ok,
    detail: ok
      ? "complete node shows agent output; pending node shows the waiting placeholder"
      : JSON.stringify({ completeText: completeText.slice(0, 40), pendingText: pendingText.slice(0, 40) }),
  };
}

/**
 * Stop — the header control must halt an in-flight run. Create a run, approve its plan so it goes active, then Stop:
 * the run settles and the control disables itself. Creates its own run so it is re-runnable.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function stopFlow(driver) {
  await startRunToPlanGate(driver, "Stop this mid-run: rebuild and verify my images.");
  await clickApprovePlan(driver);

  // Approving takes the run active, which enables Stop. Predicates run IN THE PAGE, so keep them self-contained.
  await driver.waitFor(
    () => {
      const b = [...document.querySelectorAll('[data-screen="ai.run"] .RunHeaderRight button')].find((x) =>
        (x.textContent || "").includes("Stop"),
      );
      return !!b && !b.disabled;
    },
    undefined,
    { timeout: 20000, message: "stop enabled on active run" },
  );

  await driver.evaluate(() => {
    const b = [...document.querySelectorAll('[data-screen="ai.run"] .RunHeaderRight button')].find((x) =>
      (x.textContent || "").includes("Stop"),
    );
    if (b) b.click();
  });

  // Stopping settles the run, so the control disables itself.
  await driver.waitFor(
    () => {
      const b = [...document.querySelectorAll('[data-screen="ai.run"] .RunHeaderRight button')].find((x) =>
        (x.textContent || "").includes("Stop"),
      );
      return !!b && b.disabled;
    },
    undefined,
    { timeout: 15000, message: "stop disabled after halt" },
  );
  await driver.screenshot("./webdriver/artifacts/ai-run-stop.png");
  return { name: "stop", ok: true, detail: "active run stopped; Stop control disabled" };
}

// A PENDING assistant approval card renders the Allow/Reject ButtonGroup (`.AssistantApprovalActions`); a
// resolved one renders an Allowed/Declined Tag instead. So counting `.AssistantApprovalActions` is exactly the
// number of decisions still owed. Inlined in each predicate below because predicates run IN THE PAGE.

// Ensure the Assistant is in Always-ask so gated mutations raise a native approval card. It is the default, so this
// is a no-op in the common case — and deliberately so: re-selecting the mode triggers an async global-settings
// write that races a immediately-following submit. Only when a prior state left it non-ask does it open the
// dropdown (found by mode-label text: the New-chat button also carries `.AIComposerTool` and renders first).
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
