import type { LLMAdapter, StreamEvent } from "@open-multi-agent/core";
import { describe, expect, it } from "vitest";
import type { RunEventEnvelope } from "@/ai-system/core/runEvents";
import type { GoalRunTaskSettings, ResolvedWorker } from "@/ai-system/core/types";
import { type GoalAdapterFactory, type GoalRole, makeCreateGoalRun } from "./goalOrchestrator";

const PLAN = JSON.stringify({
  tasks: [
    { id: "a", title: "Inspect", description: "inspect things", dependsOn: [], agent: "inspector" },
    { id: "b", title: "Scan", description: "scan things", dependsOn: [], agent: "scanner" },
    { id: "c", title: "Report", description: "write it up", dependsOn: ["a", "b"], agent: "writer" },
  ],
});

interface ScriptOptions {
  plan?: string;
  synthesis?: string;
  workerDelayMs?: number;
  failWorkersMatching?: RegExp;
  workerToolUse?: { name: string; input: Record<string, unknown> };
  workerToolUseFor?: RegExp;
  usagePerTurn?: { input_tokens: number; output_tokens: number };
  record?: (role: GoalRole, model: string) => void;
}

function briefOf(messages: readonly { role: string; content: readonly { type: string }[] }[]): string {
  return messages
    .flatMap((message) => message.content.map((block) => ("text" in block ? String(block.text) : "")))
    .join("\n");
}

// A role-aware scripted adapter: the coordinator answers the plan on its first turn and the synthesis on its
// second, workers answer their brief. The counter lives in the factory closure so it survives the per-turn
// adapter construction the driver does.
function scriptedFactory(options: ScriptOptions = {}): GoalAdapterFactory {
  let coordinatorTurns = 0;
  return (_task, role): LLMAdapter => ({
    name: "scripted",
    async chat() {
      throw new Error("unused");
    },
    async *stream(messages, streamOptions): AsyncIterable<StreamEvent> {
      options.record?.(role, streamOptions.model);
      const done: StreamEvent = { type: "done", data: { usage: options.usagePerTurn } };
      if (role === "coordinator") {
        coordinatorTurns += 1;
        yield {
          type: "text",
          data: coordinatorTurns === 1 ? (options.plan ?? PLAN) : (options.synthesis ?? "All good."),
        };
        yield done;
        return;
      }
      const brief = briefOf(messages as never);
      if (options.workerDelayMs) await new Promise((resolve) => setTimeout(resolve, options.workerDelayMs));
      if (streamOptions.abortSignal?.aborted) return;
      if (options.failWorkersMatching?.test(brief)) {
        yield { type: "error", data: new Error("worker exploded") };
        return;
      }
      const alreadyRanTool = messages.some((message) =>
        message.content.some((block) => (block as { type: string }).type === "tool_result"),
      );
      const toolApplies = !options.workerToolUseFor || options.workerToolUseFor.test(brief);
      if (options.workerToolUse && !alreadyRanTool && toolApplies) {
        yield { type: "tool_use", data: { type: "tool_use", id: "call-1", ...options.workerToolUse } };
        yield done;
        return;
      }
      yield { type: "text", data: "worker report" };
      yield done;
    },
  });
}

function goalTask(overrides: Partial<GoalRunTaskSettings> = {}): GoalRunTaskSettings {
  return {
    resolved: { model: "worker-model" },
    providerFetch: globalThis.fetch,
    system: "app system prompt",
    permissionMode: "ask",
    execution: {},
    budget: { maxTokens: 1_000_000, maxTasks: 8 },
    ...overrides,
  } as unknown as GoalRunTaskSettings;
}

function makeRun(factory: GoalAdapterFactory, events: RunEventEnvelope[], task: GoalRunTaskSettings = goalTask()) {
  return makeCreateGoalRun(factory)({
    runId: "r1",
    goal: "ship it",
    taskSettings: task,
    emit: (envelope) => events.push(envelope),
  });
}

const types = (events: RunEventEnvelope[]) => events.map((envelope) => envelope.event.type);

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const waitForPlan = (events: RunEventEnvelope[]) => waitFor(() => types(events).includes("plan-ready"), "plan-ready");

const waitForTerminal = (events: RunEventEnvelope[]) =>
  waitFor(
    () =>
      events.some(
        (envelope) =>
          envelope.event.type === "run-complete" ||
          envelope.event.type === "run-stopped" ||
          (envelope.event.type === "error" && envelope.event.scope !== "task"),
      ),
    "a terminal run event",
  );

const indexOfEvent = (events: RunEventEnvelope[], predicate: (event: RunEventEnvelope["event"]) => boolean) =>
  events.findIndex((envelope) => predicate(envelope.event));

describe("makeCreateGoalRun — planning and approval", () => {
  it("decomposes the goal, then blocks on plan approval before running anything", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(scriptedFactory(), events);

    const started = await run.start();
    expect(started).toMatchObject({ accepted: true, runId: "r1" });
    await waitForPlan(events);

    const view = run.snapshot();
    expect(view.phase).toBe("awaiting-plan");
    expect(view.planPending).toBe(true);
    expect(view.tasks.map((task) => task.id)).toEqual(["a", "b", "c"]);
    expect(view.tasks.every((task) => task.status === "pending")).toBe(true);
    expect(types(events)).not.toContain("task-started");
  });

  it("emits monotonic version-1 envelopes", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(scriptedFactory(), events);
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    await waitForTerminal(events);

    expect(events.map((envelope) => envelope.seq)).toEqual(events.map((_, index) => index + 1));
    for (const envelope of events) {
      expect(envelope.version).toBe(1);
      expect(envelope.runId).toBe("r1");
    }
  });

  it("rejecting the plan ends the run without dispatching a worker", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(scriptedFactory(), events);
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("reject");
    await waitForTerminal(events);

    expect(types(events)).not.toContain("task-started");
    const complete = events.find((envelope) => envelope.event.type === "run-complete");
    expect(complete?.event).toMatchObject({ finishReason: "plan-rejected" });
  });

  it("reports a plan-scoped error when the coordinator returns something unusable", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(scriptedFactory({ plan: "I cannot help with that." }), events);
    await run.start();
    await waitForTerminal(events);

    const error = events.find((envelope) => envelope.event.type === "error");
    expect(error?.event).toMatchObject({ scope: "plan" });
    expect(types(events)).not.toContain("plan-ready");
  });
});

describe("makeCreateGoalRun — scheduling", () => {
  it("runs independent tasks together and holds a dependent until both dependencies finish", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(scriptedFactory({ workerDelayMs: 25 }), events);
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    await waitForTerminal(events);

    const startedB = indexOfEvent(events, (event) => event.type === "task-started" && event.taskId === "b");
    const completedA = indexOfEvent(events, (event) => event.type === "task-completed" && event.taskId === "a");
    const startedC = indexOfEvent(events, (event) => event.type === "task-started" && event.taskId === "c");
    const completedB = indexOfEvent(events, (event) => event.type === "task-completed" && event.taskId === "b");

    // a and b have no dependency between them, so b is dispatched before a has finished.
    expect(startedB).toBeLessThan(completedA);
    // c depends on both, so it cannot start until each has completed.
    expect(startedC).toBeGreaterThan(completedA);
    expect(startedC).toBeGreaterThan(completedB);

    const view = run.snapshot();
    expect(view.phase).toBe("done");
    expect(view.tasks.map((task) => task.status)).toEqual(["complete", "complete", "complete"]);
    expect(view.synthesis).toBe("All good.");
  });

  it("fails one task and skips its dependents while an independent branch still completes", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(scriptedFactory({ failWorkersMatching: /inspect things/ }), events);
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    await waitForTerminal(events);

    const view = run.snapshot();
    expect(view.tasks.find((task) => task.id === "a")).toMatchObject({ status: "failed" });
    expect(view.tasks.find((task) => task.id === "b")).toMatchObject({ status: "complete" });
    expect(view.tasks.find((task) => task.id === "c")).toMatchObject({ status: "skipped" });
    // A task-scoped failure must not kill the run: it still synthesizes what the survivors produced.
    expect(view.phase).toBe("done");
  });
});

describe("makeCreateGoalRun — cost and safety", () => {
  it("stops early once the token budget is spent", async () => {
    const events: RunEventEnvelope[] = [];
    const task = goalTask({ budget: { maxTokens: 100, maxTasks: 8 } });
    const run = makeRun(scriptedFactory({ usagePerTurn: { input_tokens: 90, output_tokens: 40 } }), events, task);
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    await waitForTerminal(events);

    expect(types(events)).not.toContain("task-started");
    const complete = events.find((envelope) => envelope.event.type === "run-complete");
    expect(complete?.event).toMatchObject({ finishReason: "budget" });
    expect(run.snapshot().usage.inputTokens).toBeGreaterThan(0);
  });

  it("routes the coordinator to the cheaper model while workers keep the main one", async () => {
    const seen: Array<{ role: GoalRole; model: string }> = [];
    const events: RunEventEnvelope[] = [];
    const task = goalTask({ coordinatorModel: "cheap-model" });
    const run = makeRun(scriptedFactory({ record: (role, model) => seen.push({ role, model }) }), events, task);
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    await waitForTerminal(events);

    expect(seen.filter((entry) => entry.role === "coordinator").every((entry) => entry.model === "cheap-model")).toBe(
      true,
    );
    expect(seen.filter((entry) => entry.role === "worker").every((entry) => entry.model === "worker-model")).toBe(true);
  });

  const gatedTask = (onStop: () => void) =>
    goalTask({
      permissionMode: "ask",
      execution: {
        engineOps: {
          stopContainer: async () => {
            onStop();
            return true;
          },
        },
      },
    } as unknown as Partial<GoalRunTaskSettings>);

  const gatedFactory = () =>
    scriptedFactory({
      workerToolUse: { name: "stopContainer", input: { id: "abc123" } },
      workerToolUseFor: /inspect things/,
      workerDelayMs: 15,
    });

  const waitForApproval = async (events: RunEventEnvelope[]): Promise<string> => {
    await waitFor(() => types(events).includes("tool-approval-request"), "a tool approval request");
    const request = events.find((envelope) => envelope.event.type === "tool-approval-request");
    if (request?.event.type !== "tool-approval-request") throw new Error("unreachable");
    return request.event.approvalId;
  };

  it("pauses the worker on a gated tool and runs it once approved", async () => {
    let stopped = false;
    const events: RunEventEnvelope[] = [];
    const run = makeRun(
      gatedFactory(),
      events,
      gatedTask(() => {
        stopped = true;
      }),
    );
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");

    const approvalId = await waitForApproval(events);
    expect(stopped).toBe(false);
    // The blocked worker must not stall its siblings: the independent branch keeps running meanwhile.
    expect(types(events).filter((type) => type === "task-started").length).toBeGreaterThan(1);

    const resolved = await run.resolveToolApproval(approvalId, "allow");
    expect(resolved.accepted).toBe(true);
    await waitForTerminal(events);

    expect(stopped).toBe(true);
    expect(types(events)).toContain("tool-approval-resolved");
    expect(run.snapshot().phase).toBe("done");
  });

  it("skips execution when the tool approval is rejected, and the worker still reports", async () => {
    let stopped = false;
    const events: RunEventEnvelope[] = [];
    const run = makeRun(
      gatedFactory(),
      events,
      gatedTask(() => {
        stopped = true;
      }),
    );
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    const approvalId = await waitForApproval(events);
    await run.resolveToolApproval(approvalId, "reject");
    await waitForTerminal(events);

    expect(stopped).toBe(false);
    const denied = events.some(
      (envelope) => envelope.event.type === "task-delta" && envelope.event.text.includes("denied"),
    );
    expect(denied).toBe(true);
    expect(run.snapshot().phase).toBe("done");
  });

  it("rejects a pending tool approval on cancel so no worker is left waiting forever", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(
      gatedFactory(),
      events,
      gatedTask(() => undefined),
    );
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    await waitForApproval(events);
    await run.cancel();
    await waitForTerminal(events);

    expect(types(events)).toContain("run-stopped");
    expect(run.snapshot().phase).toBe("stopped");
  });

  it("reports an unknown approval id as not accepted", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(scriptedFactory(), events);
    await run.start();
    await waitForPlan(events);
    expect(await run.resolveToolApproval("ghost", "allow")).toMatchObject({ accepted: false });
  });
});

describe("makeCreateGoalRun — cancellation", () => {
  it("stops a run that is waiting on plan approval", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(scriptedFactory(), events);
    await run.start();
    await waitForPlan(events);
    await run.cancel();
    await waitForTerminal(events);

    expect(types(events)).toContain("run-stopped");
    expect(types(events)).not.toContain("task-started");
    expect(run.snapshot().phase).toBe("stopped");
  });

  it("stops a run mid-execution", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeRun(scriptedFactory({ workerDelayMs: 40 }), events);
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    await waitFor(() => types(events).includes("task-started"), "the first worker");
    await run.cancel();
    await waitForTerminal(events);

    expect(types(events)).toContain("run-stopped");
    expect(run.snapshot().phase).toBe("stopped");
  });
});

// Per-worker binding. A worker carries its own model, prompt and tool policy, and the run's plan assigns tasks
// to workers by id.
describe("makeCreateGoalRun with a worker roster", () => {
  const worker = (overrides: Partial<ResolvedWorker> = {}): ResolvedWorker =>
    ({
      id: "w1",
      name: "Auditor",
      specialty: "audits containers",
      system: "you are the auditor",
      resolved: { model: "auditor-model" },
      providerFetch: globalThis.fetch,
      policy: "granular",
      ...overrides,
    }) as unknown as ResolvedWorker;

  const ROSTER_PLAN = JSON.stringify({
    tasks: [
      { id: "a", title: "Inspect", description: "inspect things", dependsOn: [], workerId: "w1" },
      { id: "b", title: "Scan", description: "scan things", dependsOn: [], workerId: "w2" },
    ],
  });

  // THE test that catches the landmine. OMA's adapter binds its model at construction and ignores the per-call
  // `model` option, so asserting on streamOptions.model would pass even if every worker ran on the run model.
  // This asserts on what the FACTORY was handed, which is what actually selects the model.
  it("builds each worker's adapter from that worker's own model", async () => {
    const built: Array<{ role: GoalRole; model: string }> = [];
    const events: RunEventEnvelope[] = [];
    const workers = [worker(), worker({ id: "w2", name: "Scanner", resolved: { model: "scanner-model" } as never })];
    const task = goalTask({ workers });
    const inner = scriptedFactory({ plan: ROSTER_PLAN });
    const run = makeRun(
      (access, role) => {
        built.push({ role, model: access.model });
        return inner(access, role);
      },
      events,
      task,
    );
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    await waitForTerminal(events);

    const workerModels = built.filter((entry) => entry.role === "worker").map((entry) => entry.model);
    expect(new Set(workerModels)).toEqual(new Set(["auditor-model", "scanner-model"]));
    expect(built.filter((entry) => entry.role === "coordinator").every((e) => e.model === "worker-model")).toBe(true);
  });

  it("labels each task with its worker's name", async () => {
    const events: RunEventEnvelope[] = [];
    const workers = [worker(), worker({ id: "w2", name: "Scanner" })];
    const run = makeRun(scriptedFactory({ plan: ROSTER_PLAN }), events, goalTask({ workers }));
    await run.start();
    await waitForPlan(events);
    const planReady = events.find((envelope) => envelope.event.type === "plan-ready");
    expect(planReady?.event).toMatchObject({ tasks: [{ agent: "Auditor" }, { agent: "Scanner" }] });
    await run.cancel();
  });

  it("gives each worker its own system prompt", async () => {
    const seen: string[] = [];
    const events: RunEventEnvelope[] = [];
    const inner = scriptedFactory({ plan: ROSTER_PLAN });
    const workers = [worker(), worker({ id: "w2", name: "Scanner", system: "you are the scanner" })];
    const run = makeRun(
      (access, role) => {
        const adapter = inner(access, role);
        return {
          ...adapter,
          stream(messages: never, options: { systemPrompt?: string }) {
            if (role === "worker") seen.push(String(options.systemPrompt ?? ""));
            return adapter.stream(messages, options as never);
          },
        } as LLMAdapter;
      },
      events,
      goalTask({ workers }),
    );
    await run.start();
    await waitForPlan(events);
    await run.resolvePlan("allow");
    await waitForTerminal(events);
    expect(seen.some((prompt) => prompt.includes("you are the auditor"))).toBe(true);
    expect(seen.some((prompt) => prompt.includes("you are the scanner"))).toBe(true);
  });

  it("fails the plan when the coordinator names a worker outside the roster", async () => {
    const events: RunEventEnvelope[] = [];
    const plan = JSON.stringify({
      tasks: [{ id: "a", title: "Inspect", description: "inspect", dependsOn: [], workerId: "ghost" }],
    });
    const run = makeRun(scriptedFactory({ plan }), events, goalTask({ workers: [worker()] }));
    await run.start();
    await waitFor(() => types(events).includes("error"), "plan error");
    const failure = events.find((envelope) => envelope.event.type === "error");
    expect(failure?.event).toMatchObject({ scope: "plan" });
    expect(types(events)).not.toContain("task-started");
  });

  it("puts the roster in the coordinator's prompt so it can assign tasks", async () => {
    const prompts: string[] = [];
    const events: RunEventEnvelope[] = [];
    const inner = scriptedFactory({ plan: ROSTER_PLAN });
    const run = makeRun(
      (access, role) => {
        const adapter = inner(access, role);
        return {
          ...adapter,
          stream(messages: never, options: { systemPrompt?: string }) {
            if (role === "coordinator") prompts.push(String(options.systemPrompt ?? ""));
            return adapter.stream(messages, options as never);
          },
        } as LLMAdapter;
      },
      events,
      goalTask({ workers: [worker(), worker({ id: "w2", name: "Scanner" })] }),
    );
    await run.start();
    await waitForPlan(events);
    expect(prompts[0]).toContain("w1");
    expect(prompts[0]).toContain("audits containers");
    await run.cancel();
  });
});
