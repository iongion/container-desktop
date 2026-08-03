import type { LLMAdapter, LLMResponse, StreamEvent } from "@open-multi-agent/core";
import { describe, expect, it } from "vitest";
import type { RunEventEnvelope } from "@/ai-system/core/runEvents";
import type { EngineOps, ResolvedWorker, TeamRunTaskSettings } from "@/ai-system/core/types";
import { makeCreateOmaTeamRun, type OmaTeamAdapterFactory } from "@/ai-system/runtime/omaTeamRun";

const PLAN = JSON.stringify([
  {
    title: "Inspect",
    description: "Inspect the runtime",
    assignee: "worker-1",
    dependsOn: [],
  },
]);

const FAILURE_PLAN = JSON.stringify([
  { title: "Fail upstream", description: "Trigger the provider failure", assignee: "worker-1", dependsOn: [] },
  { title: "Independent", description: "Complete independently", assignee: "worker-1", dependsOn: [] },
  {
    title: "Blocked downstream",
    description: "Needs the failed report",
    assignee: "worker-1",
    dependsOn: ["Fail upstream"],
  },
]);

const SAME_WORKER_PLAN = JSON.stringify([
  { title: "Alpha", description: "Produce alpha", assignee: "worker-1", dependsOn: [] },
  { title: "Beta", description: "Produce beta", assignee: "worker-1", dependsOn: [] },
]);

const MULTI_MODEL_PLAN = JSON.stringify([
  { title: "Alpha model", description: "Use alpha", assignee: "worker-alpha", dependsOn: [] },
  { title: "Beta model", description: "Use beta", assignee: "worker-beta", dependsOn: [] },
]);

const UNKNOWN_WORKER_PLAN = JSON.stringify([
  { title: "Inspect", description: "Inspect the runtime", assignee: "missing-worker", dependsOn: [] },
]);

const MISSING_DEPENDENCY_PLAN = JSON.stringify([
  { title: "Inspect", description: "Inspect the runtime", assignee: "worker-1", dependsOn: ["Missing"] },
]);

function response(text: string, model: string): LLMResponse {
  return {
    id: crypto.randomUUID(),
    content: [{ type: "text", text }],
    model,
    stop_reason: "end_turn",
    usage: { input_tokens: 3, output_tokens: 5 },
  };
}

function scriptedFactory(
  options: { plan?: string; onCall?: (role: "coordinator" | "worker") => void } = {},
): OmaTeamAdapterFactory {
  let coordinatorTurns = 0;
  return ({ agentName, model, onToken, role }): LLMAdapter => {
    const next = (): LLMResponse => {
      options.onCall?.(role);
      const text =
        role === "coordinator" ? (++coordinatorTurns === 1 ? (options.plan ?? PLAN) : "Final answer") : "worker report";
      for (const delta of text.match(/.{1,7}/g) ?? []) onToken(agentName, delta);
      return response(text, model);
    };
    return {
      name: "scripted",
      async chat() {
        return next();
      },
      async *stream(): AsyncIterable<StreamEvent> {
        yield { type: "done", data: next() };
      },
    };
  };
}

function toolCallingFactory(): OmaTeamAdapterFactory {
  let coordinatorTurns = 0;
  let workerTurns = 0;
  return ({ agentName, model, onToken, role }): LLMAdapter => ({
    name: "scripted-tool",
    async chat() {
      if (role === "coordinator") {
        const text = ++coordinatorTurns === 1 ? PLAN : "Final answer";
        onToken(agentName, text);
        return response(text, model);
      }
      workerTurns += 1;
      if (workerTurns === 1) {
        return {
          ...response("", model),
          content: [{ type: "tool_use", id: "call-1", name: "stopContainer", input: { id: "container-1" } }],
          stop_reason: "tool_use",
        };
      }
      onToken(agentName, "worker report");
      return response("worker report", model);
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", data: response("unused", model) };
    },
  });
}

function providerFailure(message: string): Error {
  return Object.assign(new Error("Provider returned an error response"), {
    responseBody: JSON.stringify({ error: { message } }),
  });
}

function failingTaskFactory(): OmaTeamAdapterFactory {
  let coordinatorTurns = 0;
  return ({ agentName, model, onToken, role }): LLMAdapter => ({
    name: "scripted-failure",
    async chat(messages) {
      if (role === "coordinator") {
        const text = ++coordinatorTurns === 1 ? FAILURE_PLAN : "Partial synthesis";
        onToken(agentName, text);
        return response(text, model);
      }
      const prompt = messages.flatMap((message) => message.content).find((block) => block.type === "text")?.text ?? "";
      if (prompt.includes("# Task: Fail upstream")) {
        throw providerFailure("invalid/does-not-exist is not a valid model ID");
      }
      onToken(agentName, "independent report");
      return response("independent report", model);
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", data: response("unused", model) };
    },
  });
}

function parallelFailureFactory(): OmaTeamAdapterFactory {
  let coordinatorTurns = 0;
  return ({ model, role }): LLMAdapter => ({
    name: "scripted-parallel-failures",
    async chat(messages) {
      if (role === "coordinator") {
        return response(++coordinatorTurns === 1 ? SAME_WORKER_PLAN : "No successful reports", model);
      }
      const prompt = messages.flatMap((message) => message.content).find((block) => block.type === "text")?.text ?? "";
      const title = prompt.match(/^# Task: (.+)$/m)?.[1] ?? "unknown";
      throw providerFailure(`${title} provider failure`);
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", data: response("unused", model) };
    },
  });
}

function blockingFactory(): OmaTeamAdapterFactory {
  let coordinatorTurns = 0;
  return ({ model, role }): LLMAdapter => ({
    name: "scripted-blocking",
    async chat(_messages, options) {
      if (role === "coordinator") return response(++coordinatorTurns === 1 ? PLAN : "unused", model);
      await new Promise<void>((_resolve, reject) => {
        const abort = () => {
          const error = new Error("cancelled by test");
          error.name = "AbortError";
          reject(error);
        };
        if (options.abortSignal?.aborted) abort();
        else options.abortSignal?.addEventListener("abort", abort, { once: true });
      });
      return response("unreachable", model);
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", data: response("unused", model) };
    },
  });
}

function failingSynthesisFactory(): OmaTeamAdapterFactory {
  let coordinatorTurns = 0;
  return ({ model, role }): LLMAdapter => ({
    name: "scripted-synthesis-failure",
    async chat() {
      if (role === "worker") return response("worker report", model);
      if (++coordinatorTurns === 1) return response(PLAN, model);
      throw providerFailure("synthesis provider unavailable");
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", data: response("unused", model) };
    },
  });
}

function sameWorkerFactory(): OmaTeamAdapterFactory {
  let coordinatorTurns = 0;
  return ({ agentName, model, onToken, role }): LLMAdapter => ({
    name: "scripted-same-worker",
    async chat(messages) {
      if (role === "coordinator") {
        return response(++coordinatorTurns === 1 ? SAME_WORKER_PLAN : "Combined", model);
      }
      const prompt = messages.flatMap((message) => message.content).find((block) => block.type === "text")?.text ?? "";
      const title = prompt.match(/^# Task: (.+)$/m)?.[1] ?? "unknown";
      const text = `${title} report`;
      onToken(agentName, text, messages);
      return response(text, model);
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", data: response("unused", model) };
    },
  });
}

function recordingFactory(seen: Array<{ agentName: string; model: string; role: string }>): OmaTeamAdapterFactory {
  let coordinatorTurns = 0;
  return ({ agentName, model, role }): LLMAdapter => ({
    name: "scripted-routing",
    async chat() {
      seen.push({ agentName, model, role });
      const text = role === "coordinator" ? (++coordinatorTurns === 1 ? MULTI_MODEL_PLAN : "Combined") : model;
      return response(text, model);
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", data: response("unused", model) };
    },
  });
}

function worker(overrides: Partial<ResolvedWorker> = {}): ResolvedWorker {
  return {
    id: "worker-1",
    name: "Inspector",
    specialty: "Inspects runtime behavior",
    system: "Inspect carefully",
    resolved: { id: "openai", model: "gpt-4o-mini" },
    providerFetch: globalThis.fetch,
    policy: "granular",
    allowedTools: new Set(),
    execution: {},
    ...overrides,
  } as unknown as ResolvedWorker;
}

function taskSettings(resolvedWorker = worker()): TeamRunTaskSettings {
  return {
    resolved: { id: "openai", model: "gpt-4o-mini" },
    providerFetch: globalThis.fetch,
    coordinatorModel: "coordinator-model",
    system: "system",
    permissionMode: "ask",
    execution: {},
    budget: { maxTokens: 1000, maxTasks: 4 },
    workers: [resolvedWorker],
  } as unknown as TeamRunTaskSettings;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("makeCreateOmaTeamRun", () => {
  it("uses OMA orchestration behind the existing plan/run projection", async () => {
    const events: RunEventEnvelope[] = [];
    const run = makeCreateOmaTeamRun(scriptedFactory())({
      runId: "run-1",
      goal: "First inspect the runtime, then write a final implementation report",
      taskSettings: taskSettings(),
      emit: (event) => events.push(event),
    });

    await expect(run.start()).resolves.toMatchObject({ accepted: true, runId: "run-1" });
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "OMA plan gate");

    expect(run.snapshot().tasks).toMatchObject([
      {
        title: "Inspect",
        agent: "Inspector",
        workerId: "worker-1",
        status: "pending",
      },
    ]);
    expect(events.some(({ event }) => event.type === "task-started")).toBe(false);

    await expect(run.resolvePlan("allow")).resolves.toMatchObject({ accepted: true });
    await waitFor(() => run.snapshot().phase === "done", "completed OMA run");

    expect(run.snapshot()).toMatchObject({ synthesis: "Final answer" });
    expect(run.snapshot().tasks).toMatchObject([
      {
        status: "complete",
        output: "worker report",
        provider: "openai",
        inputTokens: 3,
        outputTokens: 5,
        cost: { amount: 0.00000345, currency: "USD" },
      },
    ]);
    expect(
      run.snapshot().spans.some((span) => span.kind === "task" && span.taskId === run.snapshot().tasks[0]?.id),
    ).toBe(true);
    expect(
      run.snapshot().spans.some((span) => span.kind === "llm" && span.taskId === run.snapshot().tasks[0]?.id),
    ).toBe(true);
    expect(events.some(({ event }) => event.type === "span-batch")).toBe(true);
    expect(run.snapshot().usage).toEqual({ inputTokens: 9, outputTokens: 15 });
  });

  it("forces a simple goal through OMA's coordinator so the approved plan is the executed plan", async () => {
    const calls = { coordinator: 0, worker: 0 };
    const run = makeCreateOmaTeamRun(scriptedFactory({ onCall: (role) => (calls[role] += 1) }))({
      runId: "run-simple",
      goal: "Explain container images.",
      taskSettings: taskSettings(),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "simple-objective plan gate");
    expect(calls).toEqual({ coordinator: 1, worker: 0 });
    expect(run.snapshot().tasks).toMatchObject([{ workerId: "worker-1", agent: "Inspector" }]);

    await run.resolvePlan("allow");
    await waitFor(() => run.snapshot().phase === "done", "simple OMA run");
    expect(calls).toEqual({ coordinator: 2, worker: 1 });
    expect(run.snapshot().tasks).toMatchObject([{ status: "complete", output: "worker report" }]);
  });

  it("rejects an OMA plan that exceeds the app run cap before approval", async () => {
    const oversized = JSON.stringify([
      { title: "One", description: "First", assignee: "worker-1", dependsOn: [] },
      { title: "Two", description: "Second", assignee: "worker-1", dependsOn: [] },
    ]);
    const settings = { ...taskSettings(), budget: { maxTokens: 1000, maxTasks: 1 } };
    const run = makeCreateOmaTeamRun(scriptedFactory({ plan: oversized }))({
      runId: "run-invalid",
      goal: "First inspect the runtime, then write a final implementation report",
      taskSettings: settings,
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "error", "invalid-plan rejection");
    expect(run.snapshot().error).toMatchObject({ scope: "plan" });
    expect(run.snapshot().tasks).toEqual([]);
  });

  it("rejects duplicate task titles required for unambiguous dependencies and stream attribution", async () => {
    const duplicateTitles = JSON.stringify([
      { title: "Inspect", description: "One", assignee: "worker-1", dependsOn: [] },
      { title: " inspect ", description: "Two", assignee: "worker-1", dependsOn: [] },
    ]);
    const run = makeCreateOmaTeamRun(scriptedFactory({ plan: duplicateTitles }))({
      runId: "run-duplicate-titles",
      goal: "First inspect the runtime, then inspect the configuration",
      taskSettings: taskSettings(),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "error", "duplicate-title rejection");
    expect(run.snapshot().error?.message).toContain("duplicate task title");
  });

  it("keeps the approved plan inside the selected roster when OMA normalizes an unknown assignee", async () => {
    const run = makeCreateOmaTeamRun(scriptedFactory({ plan: UNKNOWN_WORKER_PLAN }))({
      runId: "run-unknown-worker",
      goal: "Inspect the runtime with a worker from the selected roster",
      taskSettings: taskSettings(),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "normalized-worker plan gate");
    expect(run.snapshot().tasks).toMatchObject([{ workerId: "worker-1", agent: "Inspector" }]);
    await run.cancel();
  });

  it("rejects a coordinator plan containing an unresolved dependency before approval", async () => {
    const run = makeCreateOmaTeamRun(scriptedFactory({ plan: MISSING_DEPENDENCY_PLAN }))({
      runId: "run-missing-dependency",
      goal: "Inspect the runtime after the missing prerequisite",
      taskSettings: taskSettings(),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "error", "missing-dependency rejection");
    expect(run.snapshot().error?.message).toContain("invalid dependency");
    expect(run.snapshot().tasks).toEqual([]);
  });

  it("executes a worker custom tool only after the existing approval gate resolves", async () => {
    let stopCalls = 0;
    const engineOps = {
      async stopContainer() {
        stopCalls += 1;
        return true;
      },
    } as unknown as EngineOps;
    const run = makeCreateOmaTeamRun(toolCallingFactory())({
      runId: "run-tool",
      goal: "First inspect the runtime, then stop the unhealthy container",
      taskSettings: taskSettings(
        worker({
          allowedTools: new Set(["stopContainer"]),
          execution: { engineOps } as unknown as NonNullable<ResolvedWorker["execution"]>,
          policy: "granular",
        }),
      ),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "tool plan gate");
    await run.resolvePlan("allow");
    await waitFor(
      () =>
        run.snapshot().approvals.some((approval) => approval.status === "pending") ||
        ["done", "error", "stopped"].includes(run.snapshot().phase),
      "tool approval",
    );
    expect(run.snapshot().phase).not.toBe("error");
    expect(stopCalls).toBe(0);

    const approval = run.snapshot().approvals.find((candidate) => candidate.status === "pending");
    if (!approval) throw new Error(`tool approval not found: ${JSON.stringify(run.snapshot())}`);
    expect(approval.toolCallId).toBe("call-1");
    await expect(run.resolveToolApproval(approval.approvalId, "allow")).resolves.toMatchObject({ accepted: true });
    await waitFor(() => run.snapshot().phase === "done", "tool run completion");
    expect(stopCalls).toBe(1);
    expect(run.snapshot().tasks).toMatchObject([
      {
        status: "complete",
        output: expect.stringContaining("worker report"),
        toolResults: [
          {
            toolCallId: "call-1",
            tool: "stopContainer",
            title: "Stop Container",
            args: { id: "container-1" },
            ok: true,
            result: { id: "container-1", ok: true, op: "stop" },
          },
        ],
      },
    ]);
  });

  it("maps a failed dependency cascade to skipped tasks with a useful reason", async () => {
    const run = makeCreateOmaTeamRun(failingTaskFactory())({
      runId: "run-failure",
      goal: "First run independent inspections, then combine their results into a report",
      taskSettings: taskSettings(),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "failure plan gate");
    await run.resolvePlan("allow");
    await waitFor(() => run.snapshot().phase === "done", "partially failed run");

    expect(run.snapshot().tasks.find((task) => task.title === "Fail upstream")).toMatchObject({
      status: "failed",
      error: "invalid/does-not-exist is not a valid model ID",
    });
    expect(run.snapshot().tasks.find((task) => task.title === "Independent")).toMatchObject({ status: "complete" });
    expect(run.snapshot().tasks.find((task) => task.title === "Blocked downstream")).toMatchObject({
      status: "skipped",
      error: expect.stringContaining("Fail upstream"),
    });
  });

  it("keeps parallel provider failures scoped to their task when one worker runs both", async () => {
    const run = makeCreateOmaTeamRun(parallelFailureFactory())({
      runId: "run-parallel-failures",
      goal: "Run alpha and beta independently, then report both failures",
      taskSettings: taskSettings(),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "parallel-failure plan gate");
    await run.resolvePlan("allow");
    await waitFor(() => run.snapshot().tasks.every((task) => task.status === "failed"), "parallel tasks to fail");

    const errors = new Map(run.snapshot().tasks.map((task) => [task.title, task.error]));
    expect(errors.get("Alpha")).toContain("Alpha provider failure");
    expect(errors.get("Beta")).toContain("Beta provider failure");
  });

  it("attributes serialized same-worker task streams by their actual task prompt", async () => {
    const run = makeCreateOmaTeamRun(sameWorkerFactory())({
      runId: "run-same-worker",
      goal: "First produce alpha and beta independently, then combine both reports",
      taskSettings: taskSettings(),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "same-worker plan gate");
    await run.resolvePlan("allow");
    await waitFor(() => run.snapshot().phase === "done", "same-worker run");

    expect(run.snapshot().tasks.find((task) => task.title === "Alpha")?.output).toBe("Alpha report");
    expect(run.snapshot().tasks.find((task) => task.title === "Beta")?.output).toBe("Beta report");
  });

  it("routes duplicate display names by worker id with each worker's provider and model", async () => {
    const seen: Array<{ agentName: string; model: string; role: string }> = [];
    const alpha = worker({
      id: "worker-alpha",
      name: "Inspector",
      resolved: { id: "openai", model: "alpha-model" } as ResolvedWorker["resolved"],
    });
    const beta = worker({
      id: "worker-beta",
      name: "Inspector",
      resolved: { id: "anthropic", model: "beta-model" } as ResolvedWorker["resolved"],
    });
    const run = makeCreateOmaTeamRun(recordingFactory(seen))({
      runId: "run-model-routing",
      goal: "First produce alpha and beta independently, then combine both model reports",
      taskSettings: { ...taskSettings(), coordinatorModel: "cheap-model", workers: [alpha, beta] },
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "model plan gate");
    await run.resolvePlan("allow");
    await waitFor(() => run.snapshot().phase === "done", "multi-model run");

    expect(run.snapshot().tasks).toMatchObject([
      { workerId: "worker-alpha", model: "alpha-model", provider: "openai" },
      { workerId: "worker-beta", model: "beta-model", provider: "anthropic" },
    ]);
    expect(seen).toEqual(
      expect.arrayContaining([
        { agentName: "coordinator", model: "cheap-model", role: "coordinator" },
        { agentName: "worker-alpha", model: "alpha-model", role: "worker" },
        { agentName: "worker-beta", model: "beta-model", role: "worker" },
      ]),
    );
  });

  it("aborts an active OMA worker and settles the run as stopped", async () => {
    const run = makeCreateOmaTeamRun(blockingFactory())({
      runId: "run-cancel",
      goal: "First inspect the runtime, then write a final implementation report",
      taskSettings: taskSettings(),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "cancel plan gate");
    await run.resolvePlan("allow");
    await waitFor(() => run.snapshot().tasks.some((task) => task.status === "running"), "active OMA worker");
    await run.cancel();
    await waitFor(() => run.snapshot().phase === "stopped", "stopped OMA run");

    expect(run.snapshot().tasks).toMatchObject([{ status: "skipped" }]);
  });

  it("rejects a pending tool gate when the run is stopped", async () => {
    let stopCalls = 0;
    const run = makeCreateOmaTeamRun(toolCallingFactory())({
      runId: "run-tool-cancel",
      goal: "First inspect the runtime, then stop the unhealthy container",
      taskSettings: taskSettings(
        worker({
          allowedTools: new Set(["stopContainer"]),
          execution: {
            engineOps: { stopContainer: async () => (stopCalls += 1) } as unknown as EngineOps,
          } as unknown as NonNullable<ResolvedWorker["execution"]>,
        }),
      ),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "tool-cancel plan gate");
    await run.resolvePlan("allow");
    await waitFor(
      () => run.snapshot().approvals.some((approval) => approval.status === "pending"),
      "pending tool gate",
    );
    await run.cancel();
    await waitFor(() => run.snapshot().phase === "stopped", "tool-cancel stop");

    expect(stopCalls).toBe(0);
    expect(run.snapshot().approvals).toMatchObject([{ status: "rejected" }]);
  });

  it("maps a coordinator synthesis failure to the run error panel", async () => {
    const run = makeCreateOmaTeamRun(failingSynthesisFactory())({
      runId: "run-synthesis-error",
      goal: "First inspect the runtime, then write a final implementation report",
      taskSettings: taskSettings(),
      emit: () => undefined,
    });

    await run.start();
    await waitFor(() => run.snapshot().phase === "awaiting-plan", "synthesis-error plan gate");
    await run.resolvePlan("allow");
    await waitFor(() => run.snapshot().phase === "error", "synthesis error");

    expect(run.snapshot().error).toEqual({ scope: "synthesis", message: "synthesis provider unavailable" });
  });
});
