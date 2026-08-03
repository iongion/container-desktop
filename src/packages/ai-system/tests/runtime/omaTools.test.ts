import type { ToolCallContext, ToolUseContext } from "@open-multi-agent/core";
import { describe, expect, it } from "vitest";
import { toolRule } from "@/ai-system/core/permissions";
import type { RunEvent } from "@/ai-system/core/runEvents";
import type { EngineOps, ResolvedWorker, TeamRunTaskSettings } from "@/ai-system/core/types";
import {
  buildCustomTools,
  buildOmaWorkerToolset,
  createOmaToolCallSideChannel,
  makeOmaToolGate,
} from "@/ai-system/runtime/omaTools";
import type { Toolset } from "@/ai-system/runtime/tools/toolset";

const PERMISSION_CONTEXT = {
  workspaceId: "workspace-a",
  targetId: "host",
  subject: { kind: "access-profile" as const, id: "operator" },
  contentTrustEpoch: "application",
};

function echoToolset(): Toolset {
  return {
    defs: [
      {
        name: "echoValue",
        description: "Echo a value",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
    ],
    has: (name) => name === "echoValue",
    gated: () => true,
    title: () => "Echo Value",
    validate: (name, input) => {
      const record = input as { value?: unknown } | null;
      return name === "echoValue" && record && typeof record.value === "string"
        ? { ok: true, value: { value: record.value } }
        : { ok: false, error: "value must be a string" };
    },
    run: async (_name, input) => ({ ok: true, result: input, summary: input }),
  };
}

function settings(overrides: Partial<TeamRunTaskSettings> = {}): TeamRunTaskSettings {
  return {
    resolved: { model: "model" },
    providerFetch: globalThis.fetch,
    system: "system",
    permissionMode: "ask",
    permissionContext: PERMISSION_CONTEXT,
    execution: {},
    budget: { maxTokens: 1000, maxTasks: 4 },
    ...overrides,
  } as TeamRunTaskSettings;
}

function toolContext(): ToolUseContext {
  return {
    agent: { name: "worker-1", role: "worker", model: "model" },
    runId: "run-1",
    taskId: "task-1",
  };
}

describe("OMA custom tools", () => {
  it("round-trips the existing JSON schema and validates before execution", async () => {
    const results: string[] = [];
    const [tool] = buildCustomTools(echoToolset(), (name, _result, context) => {
      results.push(`${name}:${context.taskId}`);
      return undefined;
    });

    expect(tool.llmInputSchema).toMatchObject({ required: ["value"] });
    expect(tool.inputSchema.safeParse({ value: "hello" }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ value: 42 }).success).toBe(false);
    await expect(tool.execute({ value: "hello" }, toolContext())).resolves.toEqual({
      data: JSON.stringify({ value: "hello" }),
      isError: false,
    });
    expect(results).toEqual(["echoValue:task-1"]);
  });

  it("waits for result offload and returns only its opaque artifact id to the model", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const [tool] = buildCustomTools(echoToolset(), async () => {
      await blocked;
      return {
        id: "artifact-1",
        mediaType: "application/json",
        byteLength: 128,
        fingerprint: "a".repeat(64),
      };
    });
    let settled = false;
    const execution = tool.execute({ value: "hello" }, toolContext()).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    release();
    await expect(execution).resolves.toEqual({
      data: JSON.stringify({ summary: { value: "hello" }, artifactId: "artifact-1" }),
      isError: false,
    });
  });

  it("parks an OMA tool call on the existing approval event and resumes it with the decision", async () => {
    const events: RunEvent[] = [];
    const toolsets = new Map([["worker-1", echoToolset()]]);
    const gate = makeOmaToolGate({
      settings: settings(),
      toolsetsByAgent: toolsets,
      workersByAgent: new Map([["worker-1", undefined]]),
      emit: (event) => events.push(event),
    });
    const context: ToolCallContext = {
      toolName: "echoValue",
      input: { value: "hello" },
      agentName: "worker-1",
      runId: "run-1",
      taskId: "task-1",
    };

    const decision = gate.onToolCall(context);
    await Promise.resolve();
    const request = events.find((event) => event.type === "tool-approval-request");
    expect(request).toMatchObject({ taskId: "task-1", tool: "echoValue", title: "Echo Value" });
    expect(request?.type).toBe("tool-approval-request");
    if (request?.type !== "tool-approval-request") throw new Error("approval request was not emitted");

    expect(gate.resolveApproval(request.approvalId, "allow")).toBe(true);
    await expect(decision).resolves.toEqual({ action: "allow" });
    expect(events.at(-1)).toEqual({
      type: "tool-approval-resolved",
      approvalId: request.approvalId,
      decision: "allow",
    });
  });

  it("correlates OMA's id-less gate and result callbacks with the provider tool-call id", () => {
    const calls = createOmaToolCallSideChannel();
    calls.capture("worker-1", "task-1", [
      { type: "tool_use", id: "provider-call-1", name: "echoValue", input: { value: "hello" } },
    ]);
    const gateContext: ToolCallContext = {
      toolName: "echoValue",
      input: { value: "hello" },
      agentName: "worker-1",
      taskId: "task-1",
    };

    expect(calls.claim(gateContext)).toBe("provider-call-1");
    expect(calls.complete("echoValue", { value: "normalized by validation" }, toolContext())).toBe("provider-call-1");
  });

  it("invalidates a remembered allow after the task ingests untrusted tool output", async () => {
    const events: RunEvent[] = [];
    const remembered = toolRule(PERMISSION_CONTEXT, "echoValue", { value: "hello" });
    const gate = makeOmaToolGate({
      settings: settings({
        permissionMode: "remember",
        permissions: {
          version: "2.0.0",
          allowed: [remembered],
          blocked: [],
          status: "ok",
          path: "/permissions.json",
        },
      }),
      toolsetsByAgent: new Map([["worker-1", echoToolset()]]),
      workersByAgent: new Map([["worker-1", undefined]]),
      emit: (event) => events.push(event),
    });
    const context: ToolCallContext = {
      toolName: "echoValue",
      input: { value: "hello" },
      agentName: "worker-1",
      taskId: "task-1",
    };

    await expect(gate.onToolCall(context)).resolves.toEqual({ action: "allow" });
    expect(events).toEqual([]);

    gate.markTainted("task-1");
    const decision = gate.onToolCall(context);
    await Promise.resolve();
    expect(events).toMatchObject([{ type: "tool-approval-request", taskId: "task-1" }]);
    gate.rejectPending();
    await expect(decision).resolves.toEqual({ action: "deny", reason: "Tool call rejected by the user" });
  });

  it("binds each worker toolset to that worker's resolved execution target", async () => {
    const calls: string[] = [];
    const resolvedWorker = (id: string): ResolvedWorker =>
      ({
        id,
        allowedTools: new Set(["listContainers"]),
        execution: {
          engineOps: {
            listContainers: async () => {
              calls.push(id);
              return [{ Id: id }];
            },
          } as unknown as EngineOps,
        },
      }) as unknown as ResolvedWorker;
    const alpha = buildOmaWorkerToolset(settings(), resolvedWorker("alpha"));
    const beta = buildOmaWorkerToolset(settings(), resolvedWorker("beta"));

    await expect(alpha?.run("listContainers", {})).resolves.toMatchObject({ result: [{ Id: "alpha" }] });
    await expect(beta?.run("listContainers", {})).resolves.toMatchObject({ result: [{ Id: "beta" }] });
    expect(calls).toEqual(["alpha", "beta"]);
  });
});
