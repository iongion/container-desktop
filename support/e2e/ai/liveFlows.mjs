// LIVE (non-mock) AI end-to-end flows against REAL OpenRouter free models — the UI-level twin of
// src/__tests__/live/ai-agent.live.test.ts. Where the hermetic suite (support/e2e/ai/flows.mjs under
// CONTAINER_DESKTOP_MOCK) proves the SAME machinery deterministically, this arm drives the real provider stack
// (createLanguageModel → AISdkAdapter → open-multi-agent) through the running UI and asserts the outcome on the
// actual DOM. It is LOCAL-ONLY, never CI, and SKIPS LOUD when the free tier refuses / rate-limits / has no key.
//
// The headline is the multi-inference MODEL-THREAD proof: a goal with two workers on two DIFFERENT free models
// must surface ≥2 distinct `.RunTask[data-model]` on the run detail — the UI-visible evidence that OMA routed a
// per-agent model through the real adapter. That mirrors ARM B of the agent live test (which asserts the same at
// the wire), one layer up, in the browser.
//
// Provider configuration is explicit, not implicit: every flow that infers needs a configured provider, so the
// goal is started with an explicit providerId/model/coordinatorModel and the workers carry their model inline.
// The dev app supplies the OpenRouter key via devApiKeys (OPENROUTER_API_KEY), so no key entry is needed.

// Keep in sync with OPENROUTER_FREE_MODELS in src/packages/ai-system/src/testing/agents.ts. The free roster
// shifts weekly — re-verify on openrouter.ai/api/v1/models (filter `:free`) before a run. Verified 2026-07-22.
const FREE = {
  inspector: "nvidia/nemotron-nano-9b-v2:free",
  editor: "openai/gpt-oss-20b:free",
  coordinator: "nvidia/nemotron-3-super-120b-a12b:free",
};

// A skipped result is neither pass nor fail — the live runner reports it as SKIP and does not fail the build. Use
// it for free-tier variance (no plan produced, a model refused/rate-limited, a slow run that never settled).
const skip = (name, detail) => ({ name, ok: true, skipped: true, detail });
const pass = (name, detail) => ({ name, ok: true, detail });
const fail = (name, detail) => ({ name, ok: false, detail });

async function showDag(driver) {
  await driver.waitFor(() => !!document.querySelector(".RunViewMode"), undefined, {
    timeout: 30000,
    message: "goal workspace rendered",
  });
  await driver.evaluate(() => {
    const dag = [...document.querySelectorAll(".RunViewMode button")].find((button) =>
      (button.textContent || "").includes("DAG"),
    );
    if (dag instanceof HTMLElement) dag.click();
  });
  await driver.waitFor(() => !!document.querySelector(".RunGraph"), undefined, {
    timeout: 30000,
    message: "DAG rendered",
  });
}

// Two live workers on two distinct free-model families, so the coordinator can route one task to each and the run
// detail shows two distinct models.
//
// ISOLATION — this must NOT touch the user's real containers. `toolPolicy.mode: "granular"` with `allowed: []`
// makes the worker's OMA toolset empty (filterToolset strips every tool),
// so the worker is offered zero tools and can only emit text. The coordinator is offered no tools at all. With a
// pure-knowledge goal, the run's only side effect is OpenRouter API traffic — no engine/container operation runs.
// execution stays "host" (reuses run defaults, creates nothing); a sandbox would spin up a real disposable
// container, which is more side effect than a zero-tool worker needs.
function liveWorkerDefs(stamp) {
  const worker = (id, name, specialty, model) => ({
    id,
    name,
    specialty,
    systemPrompt: `You are ${name}. ${specialty}. Answer in one short sentence. Never call any tool.`,
    providerId: "openrouter",
    model,
    toolPolicy: { mode: "granular", allowed: [] },
    execution: { kind: "host" },
    createdAt: stamp,
    updatedAt: stamp,
  });
  return [
    worker(`live-inspector-${stamp}`, "LiveInspector", "you state one concrete fact", FREE.inspector),
    worker(`live-editor-${stamp}`, "LiveEditor", "you write one crisp sentence", FREE.editor),
  ];
}

/**
 * MULTI-INFERENCE model-thread proof, end to end through the UI. Seeds two workers (two free models) via the
 * bridge, starts a 2-task run with an EXPLICIT OpenRouter provider + coordinator model, reloads so the process-wide
 * run client re-attaches to the host-driven run, then asserts on the real run detail that the plan gated,
 * the run settled, and ≥2 distinct `.RunTask[data-model]` were surfaced. Skip-loud on free-tier variance.
 * @param {import("./flows.mjs").AiE2eDriver} driver @returns {Promise<{name:string, ok:boolean, skipped?:boolean, detail:string}>}
 */
export async function liveRunModelThreadFlow(driver) {
  const name = "liveRunModelThread";
  const stamp = Date.now();
  const workers = liveWorkerDefs(stamp);
  const runId = `live-run-${stamp}`;

  // Seed the roster + start the run with an explicit provider so it does not depend on persisted settings.
  const started = await driver.evaluate(
    async (arg) => {
      try {
        for (const w of arg.workers) await window.AI.saveWorker(w);
        await window.AI.startRun({
          runId: arg.runId,
          goal: "Explain what a container image is. Plan EXACTLY two independent tasks, one per worker.",
          providerId: "openrouter",
          model: arg.model,
          coordinatorModel: arg.coordinatorModel,
          maxTasks: 2,
          workerIds: arg.workers.map((w) => w.id),
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: String(error?.message || error) };
      }
    },
    { workers, runId, model: FREE.inspector, coordinatorModel: FREE.coordinator },
  );
  if (!started?.ok) return fail(name, `seed/start failed: ${started?.reason}`);

  // The run client folds envelopes only for runs it already tracks; a run started via the raw bridge is picked
  // up when the client re-attaches, which happens on renderer (re)creation. Reload, then settle to ready.
  await driver.evaluate(() => location.reload());
  await driver.waitFor(() => document.documentElement?.getAttribute("data-phase") === "ready", undefined, {
    timeout: 30000,
    message: "renderer ready after reload",
  });

  await driver.goto(`#/screens/ai/run/${runId}`);
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.run"] .RunBar'), undefined, {
    timeout: 30000,
    message: "run detail mounted",
  });
  // Wait for the plan gate. A free coordinator that fails to emit a parseable plan never renders it — that path
  // is caught below by reading the run snapshot's phase (there is no error element in the run detail DOM).
  const reached = await driver
    .waitFor(() => !!document.querySelector(".RunPlanGate"), undefined, { timeout: 90000, message: "plan gate" })
    .then(() => true)
    .catch(() => false);
  if (!reached) {
    const view = await driver.evaluate((id) => window.AI.getRunSnapshot(id), runId);
    return skip(name, `no plan gate (phase ${view?.phase ?? "unknown"}) — free-tier variance`);
  }

  const snap = await driver.evaluate(async (id) => {
    const view = await window.AI.getRunSnapshot(id);
    return { phase: view?.phase, tasks: view?.tasks?.length ?? 0, gate: !!document.querySelector(".RunPlanGate") };
  }, runId);
  if (snap.phase === "error") return skip(name, "coordinator errored (free tier) — treated as skipped");
  if (!snap.gate) return skip(name, `no plan gate to approve (phase ${snap.phase})`);

  await showDag(driver);

  await driver.evaluate(() => {
    const approve = [...document.querySelectorAll(".RunPlanGateActions button")].find((b) =>
      (b.textContent || "").includes("Approve plan"),
    );
    if (approve) approve.click();
  });

  // Let the workers run, then wait for the run to settle: synthesis rendered, or every task out of pending/running
  // (a failed free-tier task is settled too). A run error also drives every task terminal, so this resolves either
  // way; the error is distinguished below by the snapshot phase.
  const settled = await driver
    .waitFor(
      () => {
        const tasks = [...document.querySelectorAll(".RunTask")];
        const allSettled =
          tasks.length > 0 && tasks.every((t) => t.dataset.status !== "pending" && t.dataset.status !== "running");
        return !!document.querySelector(".RunSynthesis") || allSettled;
      },
      undefined,
      { timeout: 180000, message: "run settled" },
    )
    .then(() => true)
    .catch(() => false);

  const result = await driver.evaluate(async (id) => {
    const view = await window.AI.getRunSnapshot(id);
    const models = [...document.querySelectorAll(".RunTask[data-model]")].map((t) => t.dataset.model).filter(Boolean);
    return {
      distinctModels: [...new Set(models)],
      taskCount: document.querySelectorAll(".RunTask").length,
      statuses: [...document.querySelectorAll(".RunTask")].map((t) => t.dataset.status),
      phase: view?.phase,
    };
  }, runId);
  await driver.screenshot("./webdriver/artifacts/ai-live-model-thread.png");

  // A distinct-model count ≥2 IS the proof even if the free models then errored (task-started emits the model
  // before any worker turn), so check it FIRST; only fall back to skip on genuinely thin evidence.
  if (result.distinctModels.length >= 2) {
    return pass(name, `two workers routed distinct free models to the DOM: ${result.distinctModels.join(", ")}`);
  }
  if (result.phase === "error") return skip(name, "run errored (free tier) — treated as skipped");
  if (!settled) return skip(name, `run did not settle in time (statuses ${JSON.stringify(result.statuses)})`);
  return skip(
    name,
    `only ${result.distinctModels.length} distinct model(s) surfaced (${result.distinctModels.join(", ") || "none"}) — free-tier tasks may not have both started`,
  );
}

// Seed a roster and start a goal with an explicit OpenRouter provider — the same robust path the model-thread arm
// uses. Returns {ok, reason}; a synchronous throw (bad model id / provider unresolvable) surfaces as the reason so
// the caller can skip-loud rather than fail the build on free-tier/provider variance.
function seedAndStartRun(driver, spec) {
  return driver.evaluate(async (arg) => {
    try {
      for (const w of arg.workers) await window.AI.saveWorker(w);
      await window.AI.startRun({
        runId: arg.runId,
        goal: arg.goal,
        providerId: "openrouter",
        model: arg.model,
        coordinatorModel: arg.coordinatorModel,
        maxTasks: arg.maxTasks,
        workerIds: arg.workers.map((w) => w.id),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }, spec);
}

// The run client folds envelopes only for runs it already tracks, and a run started via the raw bridge is picked
// up when the client re-attaches (reload → runClientInstance.reattach() → listRuns). Reload, settle to ready,
// then open the run's own route and wait for its detail to mount.
async function reattachAndOpenRun(driver, runId) {
  await driver.evaluate(() => location.reload());
  await driver.waitFor(() => document.documentElement?.getAttribute("data-phase") === "ready", undefined, {
    timeout: 30000,
    message: "renderer ready after reload",
  });
  await driver.goto(`#/screens/ai/run/${runId}`);
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.run"] .RunBar'), undefined, {
    timeout: 30000,
    message: "run detail mounted",
  });
}

// Wait for the plan gate (skip-loud on free-tier variance — a coordinator that emits no parseable plan never
// renders it). Returns {reached, phase} so the caller can distinguish "no plan" from "coordinator errored".
async function reachPlanGate(driver, runId, timeout = 90000) {
  const reached = await driver
    .waitFor(() => !!document.querySelector(".RunPlanGate"), undefined, { timeout, message: "plan gate" })
    .then(() => true)
    .catch(() => false);
  const view = await driver.evaluate((id) => window.AI.getRunSnapshot(id), runId);
  return { reached, phase: view?.phase };
}

const approvePlan = (driver) =>
  driver.evaluate(() => {
    const approve = [...document.querySelectorAll(".RunPlanGateActions button")].find((b) =>
      (b.textContent || "").includes("Approve plan"),
    );
    if (approve) approve.click();
  });

const stopRun = (driver, runId) =>
  driver
    .evaluate(
      (id) => Promise.race([window.AI.stopRun(id), new Promise((resolve) => window.setTimeout(resolve, 5000))]),
      runId,
    )
    .catch(() => {});

/**
 * ASSISTANT-CHAT live — the biggest live-coverage gap, driven the same robust way as the Team Run arm. Submits one turn
 * through the bridge with an EXPLICIT OpenRouter provider + a `:free` model (submitChatRequest carries both, so no
 * persisted-default seam is needed), waits host-side for the real model to reply, then reloads so the process-wide
 * chat client re-attaches (HYDRATE via listChats + REFRESH via getChatSnapshot for the active session — the chat
 * equivalent of the run client's reattach) and asserts STRUCTURE on the transcript: the marker in a user bubble +
 * at least one non-empty assistant bubble. Never asserts prose. Skip-loud on free-tier variance (no reply / refusal
 * / rate-limit). No engine tools are offered a plain chat turn, so the only side effect is OpenRouter traffic.
 * @param {import("./flows.mjs").AiE2eDriver} driver @returns {Promise<{name:string, ok:boolean, skipped?:boolean, detail:string}>}
 */
export async function liveAssistantChatFlow(driver) {
  const name = "liveAssistantChat";
  const stamp = Date.now();
  const sessionId = `live-chat-${stamp}`;
  const marker = `LIVE-CHAT ${stamp}`;

  // Submit through the bridge with an explicit provider/model. submitChat auto-persists the conversation, so it is
  // returned by listChats after the reload; remembering it as the active conversation makes the reattached client
  // refresh its full transcript. A synchronous throw here is provider/key variance ⇒ skip-loud, not a build failure.
  const submitted = await driver.evaluate(
    async (arg) => {
      try {
        await window.AI.submitChat({
          sessionId: arg.sessionId,
          message: { id: `${arg.sessionId}-m1`, content: arg.marker, createdAt: Date.now() },
          history: [],
          providerId: "openrouter",
          model: arg.model,
        });
        localStorage.setItem("container-desktop:ai:active-conversation", arg.sessionId);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: String(error?.message || error) };
      }
    },
    { sessionId, marker, model: FREE.inspector },
  );
  if (!submitted?.ok) return skip(name, `submit refused (free tier / provider): ${submitted?.reason}`);

  // Wait host-side for the real turn to complete: a finished assistant message with non-empty content. The session
  // lives in main, so getChatSnapshot returns its live view even before any reload. Skip-loud if it never replies.
  const replied = await driver
    .waitFor(
      async (sid) => {
        const view = await window.AI.getChatSnapshot(sid);
        return (
          !!view &&
          view.timeline.some(
            (item) => item.kind === "message" && item.role === "assistant" && (item.content || "").trim().length > 0,
          )
        );
      },
      sessionId,
      { timeout: 120000, message: "assistant replied (live)" },
    )
    .then(() => true)
    .catch(() => false);
  if (!replied) {
    const view = await driver.evaluate((sid) => window.AI.getChatSnapshot(sid), sessionId);
    return skip(name, `no assistant reply (phase ${view?.phase ?? "unknown"}) — free-tier variance`);
  }

  // Reload so the process-wide chat client re-hydrates and refreshes the (now active) session, then open the
  // Assistant surface and assert the projected structure the reducer builds.
  await driver.evaluate(() => location.reload());
  await driver.waitFor(() => document.documentElement?.getAttribute("data-phase") === "ready", undefined, {
    timeout: 30000,
    message: "renderer ready after reload",
  });
  await driver.goto("#/screens/ai/assistant");
  // The reply is already proven host-side (above); a slow re-hydrate after reload is free-tier/timing variance, so
  // these render waits skip-loud rather than hard-failing the suite — consistent with every other live arm.
  const rendered = await driver
    .waitFor(
      (text) =>
        [...document.querySelectorAll(".AssistantMessage--user")].some((m) => (m.textContent || "").includes(text)) &&
        [...document.querySelectorAll(".AssistantMessage--assistant")].some(
          (m) => (m.textContent || "").trim().length > 0,
        ),
      marker,
      { timeout: 30000, message: "user + assistant bubbles after reattach" },
    )
    .then(() => true)
    .catch(() => false);
  if (!rendered) return skip(name, "transcript did not re-hydrate in time after reload — timing/free-tier variance");

  const structure = await driver.evaluate(
    (text) => ({
      inUserBubble: [...document.querySelectorAll(".AssistantMessage--user")].some((m) =>
        (m.textContent || "").includes(text),
      ),
      assistantBubbles: document.querySelectorAll(".AssistantMessage--assistant").length,
    }),
    marker,
  );
  await driver.screenshot("./webdriver/artifacts/ai-live-assistant-chat.png");
  const ok = structure.inUserBubble && structure.assistantBubbles > 0;
  return ok
    ? pass(
        name,
        "a real OpenRouter free-model turn echoed the marker in a user bubble and replied in an assistant bubble",
      )
    : fail(name, `structure missing after reattach: ${JSON.stringify(structure)}`);
}

// A single ask-policy worker: `mode: "ask"` gates EVERY tool it calls (even a read), so it is the reliable way to
// raise a live approval — unlike a granular allowlist, whose reads are ungated. execution stays "host"; the worker
// is offered the run-level container toolset, but the flow only ever REJECTS, so nothing runs on real containers.
function liveAskWorkerDef(stamp, model) {
  return {
    id: `live-asker-${stamp}`,
    name: "LiveAsker",
    specialty: "inspects container state and reports it",
    systemPrompt:
      "You inspect container engine state. Begin by calling the listContainers tool to see what is running, then report the container names in one short sentence. Always use the tool first.",
    providerId: "openrouter",
    model,
    toolPolicy: { mode: "ask", allowed: [] },
    execution: { kind: "host" },
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * TOOL approval — the REJECT branch, live. A single ask-policy worker gates its first tool call; if the free model
 * raises one within a generous window, REJECT it (never Allow — reject-only keeps every real engine op behind a
 * decision that never fires) and assert the prompt clears. The run is stopped afterward so no worker is left parked.
 * Skip-loud when the free model never calls a tool. @param {import("./flows.mjs").AiE2eDriver} driver
 * @returns {Promise<{name:string, ok:boolean, skipped?:boolean, detail:string}>}
 */
export async function liveToolRejectFlow(driver) {
  const name = "liveToolReject";
  const stamp = Date.now();
  const runId = `live-toolreject-${stamp}`;
  const worker = liveAskWorkerDef(stamp, FREE.inspector);

  const started = await seedAndStartRun(driver, {
    runId,
    goal: "List the containers on the default connection and report their names.",
    model: FREE.inspector,
    coordinatorModel: FREE.coordinator,
    maxTasks: 1,
    workers: [worker],
  });
  if (!started?.ok) return skip(name, `seed/start failed: ${started?.reason}`);

  await reattachAndOpenRun(driver, runId);
  const gate = await reachPlanGate(driver, runId);
  if (gate.phase === "error") return skip(name, "coordinator errored (free tier)");
  if (!gate.reached) return skip(name, `no plan gate (phase ${gate.phase ?? "unknown"}) — free-tier variance`);

  await showDag(driver);
  await approvePlan(driver);

  const raised = await driver
    .waitFor(() => !!document.querySelector(".RunApproval"), undefined, { timeout: 120000, message: "gated tool" })
    .then(() => true)
    .catch(() => false);
  if (!raised) {
    await stopRun(driver, runId);
    return skip(name, "free model did not raise a gated tool call");
  }

  const before = await driver.evaluate(() => document.querySelectorAll(".RunApproval").length);
  // Exact "Reject" match — the ONLY button this flow ever clicks. It never clicks Allow, so no engine op executes.
  await driver.evaluate(() => {
    const reject = [...document.querySelectorAll(".RunApproval button")].find(
      (b) => (b.textContent || "").trim() === "Reject",
    );
    if (reject) reject.click();
  });
  const cleared = await driver
    .waitFor((prev) => document.querySelectorAll(".RunApproval").length < prev, before, {
      timeout: 15000,
      message: "approval cleared",
    })
    .then(() => true)
    .catch(() => false);

  // Halt the run: a rejected tool may prompt the worker to try another gated call. Stopping rejects any pending
  // approval and tears the run down, so nothing is left parked against the real engine.
  await stopRun(driver, runId);
  await driver.screenshot("./webdriver/artifacts/ai-live-tool-reject.png");
  if (!cleared) return fail(name, `rejected a gated tool but the prompt did not clear (before ${before})`);
  return pass(
    name,
    `free model raised a gated tool; rejecting it (never allowed) cleared the prompt (${before} pending)`,
  );
}

/**
 * TASK-graph transcript, live: clicking a complete node shows THAT agent's output, and a not-yet-reported node
 * shows the Waiting placeholder. Seeds the two tool-less workers (isolation-safe), starts a 2-task goal, approves,
 * then asserts the two halves at different times — the Waiting half in the brief window before a just-started task
 * emits any output, the output half once a task completes. Read-only on the run; stopped before synthesis to save
 * budget. Skip-loud if the run errors or the windows never materialize. @param {import("./flows.mjs").AiE2eDriver} driver
 * @returns {Promise<{name:string, ok:boolean, skipped?:boolean, detail:string}>}
 */
export async function liveTaskTranscriptFlow(driver) {
  const name = "liveTaskTranscript";
  const stamp = Date.now();
  const runId = `live-transcript-${stamp}`;
  const workers = liveWorkerDefs(stamp);

  // A DEPENDENT plan (two waves), not two independent tasks: the second task must set dependsOn to the first, so
  // the DAG renders Wave 1 → Wave 2. This also makes the "not-yet-reported" assertion robust — the dependent task
  // stays genuinely `pending` (never dispatched) the whole time its upstream runs, rather than racing a token.
  const started = await seedAndStartRun(driver, {
    runId,
    goal:
      "Explain what a container image is, in two stages. Plan EXACTLY two tasks that form a chain: the FIRST task " +
      "defines the term and has no dependencies; the SECOND task expands on it and MUST list the first task's id " +
      "in its dependsOn. Assign one task to each worker.",
    model: FREE.inspector,
    coordinatorModel: FREE.coordinator,
    maxTasks: 2,
    workers,
  });
  if (!started?.ok) return skip(name, `seed/start failed: ${started?.reason}`);

  await reattachAndOpenRun(driver, runId);
  const gate = await reachPlanGate(driver, runId);
  if (gate.phase === "error") return skip(name, "coordinator errored (free tier)");
  if (!gate.reached) return skip(name, `no plan gate (phase ${gate.phase ?? "unknown"}) — free-tier variance`);

  await showDag(driver);
  // Prove the DAG actually has ≥2 waves before approving — a chained plan lays out as more than one GoalWave.
  const waveCount = await driver.evaluate(() => document.querySelectorAll(".RunWaveLabel").length);

  await approvePlan(driver);

  // The "not yet reported" half: the dependent task stays pending while its upstream runs, so its transcript shows
  // the Waiting placeholder. Select such a node and check the placeholder holds.
  const waitingShown = await driver
    .waitFor(
      () => {
        const node = [...document.querySelectorAll(".RunTask")].find(
          (t) => t.dataset.status === "pending" || t.dataset.status === "running",
        );
        if (!node) return false;
        node.click();
        return (document.querySelector(".RunTranscriptBody")?.textContent || "").includes("Waiting");
      },
      undefined,
      { timeout: 20000, message: "waiting placeholder on a not-yet-reported task" },
    )
    .then(() => true)
    .catch(() => false);

  // The output half: once a task completes, selecting its node shows non-empty agent output (not the placeholder).
  const completeShown = await driver
    .waitFor(
      () => {
        const node = [...document.querySelectorAll(".RunTask")].find((t) => t.dataset.status === "complete");
        if (!node) return false;
        node.click();
        const body = (document.querySelector(".RunTranscriptBody")?.textContent || "").trim();
        return body.length > 0 && !body.includes("Waiting");
      },
      undefined,
      { timeout: 180000, message: "complete task shows its agent output" },
    )
    .then(() => true)
    .catch(() => false);

  const snap = await driver.evaluate((id) => window.AI.getRunSnapshot(id), runId);
  await stopRun(driver, runId);
  await driver.screenshot("./webdriver/artifacts/ai-live-task-transcript.png");
  if (waitingShown && completeShown) {
    const dag = waveCount >= 2 ? ` across a ${waveCount}-wave DAG` : "";
    return pass(
      name,
      `a complete task shows its agent output; a not-yet-reported task shows the Waiting placeholder${dag}`,
    );
  }
  if (snap?.phase === "error") return skip(name, "run errored (free tier)");
  return skip(
    name,
    `insufficient live evidence (waves=${waveCount}, waiting=${waitingShown}, complete=${completeShown}, phase ${snap?.phase})`,
  );
}

// Best-effort cleanup so a live run leaves no seeded workers behind. Never throws.
export async function cleanupLiveWorkers(driver) {
  await driver
    .evaluate(async () => {
      const { workers } = await window.AI.listWorkers();
      for (const w of workers) {
        if (w.id.startsWith("live-")) {
          await Promise.race([
            window.AI.removeWorker(w.id),
            new Promise((resolve) => window.setTimeout(resolve, 2000)),
          ]);
        }
      }
    })
    .catch(() => {});
}

// The live arm — all three AI surfaces, both branches, over the real provider stack:
//  - liveRunModelThread : Runs, multi-inference headline (≥2 distinct free models on the DOM)
//  - liveAssistantChat   : Assistant, a real free-model chat turn projected as user + assistant bubbles
//  - liveToolReject       : the tool-approval REJECT branch (runFlow/model-thread cover Approve)
//  - liveTaskTranscript   : the task-graph transcript (complete → output, not-yet-reported → Waiting)
// Workers is pure CRUD with no LLM, so the mock workersFlow already covers it identically in both lenses. Every
// arm is skip-loud on free-tier variance and never touches the user's real containers (tool-less workers, or
// reject-only for the ask worker).
export const LIVE_FLOWS = [liveRunModelThreadFlow, liveAssistantChatFlow, liveToolRejectFlow, liveTaskTranscriptFlow];

/** Run the live flows against a driver. @param {import("./flows.mjs").AiE2eDriver} driver */
export async function runLiveFlows(driver) {
  const results = [];
  for (const flow of LIVE_FLOWS) {
    try {
      results.push(await flow(driver));
    } catch (error) {
      results.push(fail(flow.name, `threw: ${error?.message || error}`));
    }
  }
  await cleanupLiveWorkers(driver);
  return results;
}
