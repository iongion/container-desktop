import type { LLMAdapter, LLMMessage, LLMResponse } from "@open-multi-agent/core";
import { describe, expect, it } from "vitest";
import { toolRule } from "@/ai-system/core/permissions";
import type { ThreadEventEnvelope } from "@/ai-system/core/threadEvents";
import type { AgentSessionCreationOptions, AgentSessionTaskSettings } from "@/ai-system/core/types";
import {
  makeCreateOmaAgentSession,
  type OmaAgentSessionAdapterFactory,
  type OmaAgentSessionAdapterObserver,
} from "@/ai-system/runtime/omaAgentSessionRuntime";

const PERMISSION_CONTEXT = {
  workspaceId: "workspace-a",
  targetId: "host",
  subject: { kind: "access-profile" as const, id: "operator" },
  contentTrustEpoch: "application",
};

const TASK = {
  resolved: { id: "openrouter", model: "test-model" },
  providerFetch: globalThis.fetch,
  system: "system prompt",
  permissionMode: "ask",
  permissionContext: PERMISSION_CONTEXT,
  execution: {},
} as unknown as AgentSessionTaskSettings;

function response(content: LLMResponse["content"]): LLMResponse {
  return {
    id: crypto.randomUUID(),
    content,
    model: "test-model",
    stop_reason: "end_turn",
    usage: { input_tokens: 2, output_tokens: 3 },
  };
}

function makeOptions(
  emit: (event: ThreadEventEnvelope) => void,
  overrides: Partial<AgentSessionCreationOptions> = {},
): AgentSessionCreationOptions {
  return { threadId: "session-1", history: [], taskSettings: TASK, emit, ...overrides };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
}

async function waitForTerminal(events: ThreadEventEnvelope[]): Promise<void> {
  await waitFor(() =>
    events.some(
      ({ event }) => event.type === "task-complete" || event.type === "task-stopped" || event.type === "error",
    ),
  );
}

function textFactory(text: string, calls?: LLMMessage[][]): OmaAgentSessionAdapterFactory {
  return (_task, observer) => ({
    name: "scripted",
    async chat(messages) {
      calls?.push(structuredClone(messages) as LLMMessage[]);
      observer.onToken("Hel", messages);
      observer.onToken(text.slice(3), messages);
      return response([{ type: "text", text }]);
    },
    async *stream() {
      yield { type: "error", data: new Error("OMA Agent must use chat(), not the owned adapter stream loop") };
    },
  });
}

describe("makeCreateOmaAgentSession", () => {
  it("captures target-bound workspace changes before model execution and publishes the turn delta", async () => {
    const events: ThreadEventEnvelope[] = [];
    const order: string[] = [];
    let capture = 0;
    const workspaceChanges = {
      status: async () => {
        capture += 1;
        order.push(capture === 1 ? "before" : "after");
        return {
          target: { kind: "host" as const },
          workspaceRoot: "/workspace",
          state: "changes" as const,
          entries:
            capture === 1
              ? [{ path: "existing.ts", index: "unchanged" as const, worktree: "modified" as const }]
              : [
                  { path: "existing.ts", index: "unchanged" as const, worktree: "modified" as const },
                  { path: "new.ts", index: "untracked" as const, worktree: "untracked" as const },
                ],
          fingerprint: capture === 1 ? "before" : "after",
          truncated: false,
        };
      },
      diff: async () => {
        throw new Error("not used");
      },
    };
    const task = { ...TASK, execution: { workspaceChanges } } as unknown as AgentSessionTaskSettings;
    const factory: OmaAgentSessionAdapterFactory = (_task, observer) => ({
      name: "change-capture",
      async chat(messages) {
        order.push("model");
        observer.onToken("Done", messages);
        return response([{ type: "text", text: "Done" }]);
      },
      async *stream() {},
    });
    const session = makeCreateOmaAgentSession(factory)(
      makeOptions((event) => events.push(event), { taskSettings: task }),
    );

    await session.submit({ id: "m1", content: "edit", createdAt: 1 });
    await waitForTerminal(events);

    expect(order).toEqual(["before", "model", "after"]);
    expect(events.map(({ event }) => event.type).slice(-2)).toEqual(["workspace-changes", "task-complete"]);
    expect(events.at(-2)?.event).toMatchObject({
      type: "workspace-changes",
      summary: {
        target: { kind: "host" },
        workspaceRoot: "/workspace",
        beforeCount: 1,
        afterCount: 2,
        introduced: ["new.ts"],
      },
    });
  });

  it("continues the durable projection sequence and usage after a lazy restore", async () => {
    const events: ThreadEventEnvelope[] = [];
    const restored = {
      threadId: "session-1",
      phase: "idle" as const,
      lastSeq: 9,
      timeline: [],
      usage: { requests: 2, inputTokens: 20, outputTokens: 10, costs: [] },
      context: {
        providerId: "openrouter",
        model: "test-model",
        capturedAt: 1,
        window: { status: "unknown" as const },
        sections: [],
        totals: { characters: 0, estimatedTokens: 0 },
        sources: [{ kind: "skill" as const, trust: "project" as const, characters: 25 }],
        tools: [],
        permissionMode: "ask" as const,
        truncation: { applied: false, omittedMessages: 0 },
      },
    };
    const session = makeCreateOmaAgentSession(textFactory("Hello"))(
      makeOptions((event) => events.push(event), { view: restored } as Partial<AgentSessionCreationOptions>),
    );

    await session.submit({ id: "m1", content: "continue", createdAt: 1 });
    await waitForTerminal(events);

    expect(events[0].seq).toBe(10);
    expect(session.snapshot().usage).toMatchObject({ requests: 3, inputTokens: 22, outputTokens: 13 });
    expect(events.find(({ event }) => event.type === "context")?.event).toMatchObject({
      context: { sources: [{ kind: "skill", trust: "project", characters: 25 }] },
    });
  });

  it("streams provider deltas through the public OMA Agent runner and persists structured history", async () => {
    const events: ThreadEventEnvelope[] = [];
    const calls: LLMMessage[][] = [];
    const session = makeCreateOmaAgentSession(textFactory("Hello", calls))(makeOptions((event) => events.push(event)));

    const submitted = await session.submit({ id: "m1", content: "hi", createdAt: 1 });
    expect(submitted).toMatchObject({ accepted: true, mode: "started", phase: "model" });
    await waitForTerminal(events);

    expect(events.map(({ event }) => event.type)).toEqual([
      "phase-changed",
      "user-message",
      "context",
      "assistant-start",
      "assistant-delta",
      "assistant-delta",
      "assistant-end",
      "usage",
      "task-complete",
    ]);
    expect(calls[0]).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
    expect(session.durableSnapshot().modelHistory).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    ]);
    const traceRecords = session.durableSnapshot().traceRecords ?? [];
    expect(traceRecords.length).toBeGreaterThan(0);
    expect(traceRecords.every((record) => !record || typeof record !== "object" || !("attributes" in record))).toBe(
      true,
    );
  });

  it("publishes the exact adapter request shape and accumulates provider-reported usage", async () => {
    const events: ThreadEventEnvelope[] = [];
    const calls: Array<{ messages: LLMMessage[]; systemPrompt?: string; tools?: readonly unknown[] }> = [];
    const factory: OmaAgentSessionAdapterFactory = (_task, observer) => ({
      name: "context-capture",
      async chat(messages, options) {
        calls.push({
          messages: structuredClone(messages) as LLMMessage[],
          systemPrompt: options.systemPrompt,
          tools: options.tools ? structuredClone(options.tools) : undefined,
        });
        observer.onToken("Done", messages);
        return response([{ type: "text", text: "Done" }]);
      },
      async *stream() {},
    });
    const session = makeCreateOmaAgentSession(factory)(makeOptions((event) => events.push(event)));

    await session.submit({ id: "m1", content: "inspect", createdAt: 1 });
    await waitForTerminal(events);

    const contextEvent = events.find(({ event }) => event.type === "context")?.event;
    if (contextEvent?.type !== "context") throw new Error("context event missing");
    expect(contextEvent.context.sections).toEqual([
      expect.objectContaining({ kind: "system", characters: calls[0].systemPrompt?.length }),
      expect.objectContaining({ kind: "history", items: 0 }),
      expect.objectContaining({ kind: "turn", items: calls[0].messages.length }),
      expect.objectContaining({ kind: "tools", items: calls[0].tools?.length ?? 0 }),
    ]);
    expect(JSON.stringify(contextEvent.context)).not.toContain("inspect");
    expect(events).toContainEqual(
      expect.objectContaining({ event: { type: "usage", inputTokens: 2, outputTokens: 3 } }),
    );
    expect(session.snapshot().usage).toMatchObject({ requests: 1, inputTokens: 2, outputTokens: 3 });
  });

  it("keeps a skill command visible while sending its host-rendered prompt to the model", async () => {
    const events: ThreadEventEnvelope[] = [];
    const calls: LLMMessage[][] = [];
    const session = makeCreateOmaAgentSession(textFactory("Done", calls))(makeOptions((event) => events.push(event)));
    const skill = {
      skillId: "skill:user:review",
      command: "/skill:user:review",
      source: "user" as const,
      fingerprint: "a".repeat(64),
    };
    await session.submit({
      id: "m1",
      content: "HOST RENDERED SKILL PROMPT",
      displayContent: "/skill:user:review src",
      createdAt: 1,
      skill,
    });
    await waitForTerminal(events);

    expect(calls[0]).toEqual([{ role: "user", content: [{ type: "text", text: "HOST RENDERED SKILL PROMPT" }] }]);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({ type: "user-message", content: "/skill:user:review src", skill }),
      }),
    );
    expect(session.durableSnapshot().view.timeline[0]).toMatchObject({ content: "/skill:user:review src", skill });
  });

  it("prepends validated persisted history and switches provider settings on the next submit", async () => {
    const calls: Array<{ model: string | undefined; messages: LLMMessage[] }> = [];
    const factory: OmaAgentSessionAdapterFactory = (task, observer) => ({
      name: "capture",
      async chat(messages) {
        calls.push({ model: task.resolved.model, messages: structuredClone(messages) as LLMMessage[] });
        observer.onToken("ok", messages);
        return response([{ type: "text", text: "ok" }]);
      },
      async *stream() {},
    });
    const persisted = [
      { role: "user", content: [{ type: "text", text: "earlier" }] },
      { role: "assistant", content: [{ type: "text", text: "context" }] },
    ];
    const events: ThreadEventEnvelope[] = [];
    const session = makeCreateOmaAgentSession(factory)(
      makeOptions((event) => events.push(event), { modelHistory: persisted }),
    );

    await session.submit({ id: "m1", content: "first", createdAt: 1 });
    await waitForTerminal(events);
    const switched = { ...TASK, resolved: { ...TASK.resolved, model: "other-model" } };
    await session.submit({ id: "m2", content: "second", createdAt: 2 }, switched);
    await waitFor(() => events.filter(({ event }) => event.type === "task-complete").length === 2);

    expect(calls[0].messages.slice(0, 2)).toEqual(persisted);
    expect(calls.map(({ model }) => model)).toEqual(["test-model", "other-model"]);
    expect(calls[1].messages).toHaveLength(5);
  });

  it("projects an active compaction summary plus canonical tail without changing durable history", async () => {
    const calls: Array<{ messages: LLMMessage[]; systemPrompt?: string }> = [];
    const events: ThreadEventEnvelope[] = [];
    const modelHistory = [
      { role: "user", content: [{ type: "text", text: "old question" }] },
      { role: "assistant", content: [{ type: "text", text: "old answer" }] },
      { role: "user", content: [{ type: "text", text: "recent question" }] },
      { role: "assistant", content: [{ type: "text", text: "recent answer" }] },
    ];
    const factory: OmaAgentSessionAdapterFactory = (_task, observer) => ({
      name: "compacted",
      async chat(messages, options) {
        calls.push({ messages: structuredClone(messages) as LLMMessage[], systemPrompt: options.systemPrompt });
        observer.onToken("continued", messages);
        return response([{ type: "text", text: "continued" }]);
      },
      async *stream() {},
    });
    const session = makeCreateOmaAgentSession(factory)(
      makeOptions((event) => events.push(event), {
        modelHistory,
        activeCompaction: {
          id: "compaction-1",
          createdAt: 2,
          source: { historyStart: 0, historyEnd: 2, messageStartId: "old-user", messageEndId: "old-assistant" },
          summary: "The operator inspected the earlier state and found no failures.",
          inputTokens: 80,
          outputTokens: 20,
          fingerprint: "a".repeat(64),
          contentTrust: "application",
          tainted: false,
        },
      }),
    );

    await session.submit({ id: "m1", content: "continue", createdAt: 3 });
    await waitForTerminal(events);

    expect(calls[0].messages.slice(0, 2)).toEqual(modelHistory.slice(2));
    expect(calls[0].messages).not.toContainEqual(modelHistory[0]);
    expect(calls[0].systemPrompt).toContain("The operator inspected the earlier state");
    expect(calls[0].systemPrompt).toContain("derived summary");
    expect(session.durableSnapshot().modelHistory.slice(0, 4)).toEqual(modelHistory);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          type: "context",
          context: expect.objectContaining({ truncation: { applied: true, omittedMessages: 2 } }),
        }),
      }),
    );
  });

  it("rebuilds the toolset from the next task's resolved execution target", async () => {
    const events: ThreadEventEnvelope[] = [];
    let turn = 0;
    let listed = false;
    const factory: OmaAgentSessionAdapterFactory = (_task, observer) => ({
      name: "execution-switch",
      async chat(messages) {
        turn += 1;
        if (turn === 1) {
          observer.onToken("first", messages);
          return response([{ type: "text", text: "first" }]);
        }
        if (turn === 2) {
          return response([{ type: "tool_use", id: "list-1", name: "listContainers", input: {} }]);
        }
        observer.onToken("listed", messages);
        return response([{ type: "text", text: "listed" }]);
      },
      async *stream() {},
    });
    const session = makeCreateOmaAgentSession(factory)(makeOptions((event) => events.push(event)));

    await session.submit({ id: "m1", content: "first", createdAt: 1 });
    await waitForTerminal(events);
    await session.submit({ id: "m2", content: "list", createdAt: 2 }, {
      ...TASK,
      permissionMode: "allow",
      execution: {
        engineOps: {
          listContainers: async () => {
            listed = true;
            return [];
          },
        },
      },
    } as unknown as AgentSessionTaskSettings);
    await waitFor(() => events.filter(({ event }) => event.type === "task-complete").length === 2);

    expect(listed).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({ event: expect.objectContaining({ type: "tool-result", toolCallId: "list-1" }) }),
    );
  });

  it("lets a skill allowlist remove tools but never add unavailable tools", async () => {
    const events: ThreadEventEnvelope[] = [];
    let stopped = false;
    let turn = 0;
    const factory: OmaAgentSessionAdapterFactory = (_task, observer) => ({
      name: "skill-tools",
      async chat(messages) {
        turn += 1;
        if (turn === 1)
          return response([{ type: "tool_use", id: "stop-1", name: "stopContainer", input: { id: "c1" } }]);
        observer.onToken("denied", messages);
        return response([{ type: "text", text: "denied" }]);
      },
      async *stream() {},
    });
    const session = makeCreateOmaAgentSession(factory)(makeOptions((event) => events.push(event)));
    await session.submit({ id: "m1", content: "try", createdAt: 1 }, {
      ...TASK,
      permissionMode: "allow",
      allowedTools: new Set(["readFile", "notARealTool"]),
      execution: {
        engineOps: {
          stopContainer: async () => {
            stopped = true;
          },
        },
      },
    } as unknown as AgentSessionTaskSettings);
    await waitForTerminal(events);
    expect(stopped).toBe(false);
    expect(events.some(({ event }) => event.type === "tool-start" || event.type === "approval-request")).toBe(false);
  });

  it("taints a project-skill turn before its first gated tool call", async () => {
    const events: ThreadEventEnvelope[] = [];
    const input = { id: "c1" };
    const factory: OmaAgentSessionAdapterFactory = () => ({
      name: "project-skill-taint",
      async chat() {
        return response([{ type: "tool_use", id: "stop-1", name: "stopContainer", input }]);
      },
      async *stream() {},
    });
    const session = makeCreateOmaAgentSession(factory)(makeOptions((event) => events.push(event)));
    await session.submit({ id: "m1", content: "try", createdAt: 1 }, {
      ...TASK,
      permissionMode: "remember",
      initialTaint: true,
      permissions: {
        version: "2.0.0",
        status: "ok",
        path: "/permissions.json",
        allowed: [toolRule(PERMISSION_CONTEXT, "stopContainer", input)],
        blocked: [],
      },
      execution: { engineOps: { stopContainer: async () => {} } },
    } as unknown as AgentSessionTaskSettings);
    await waitFor(() => events.some(({ event }) => event.type === "approval-request"));
    expect(events).toContainEqual(
      expect.objectContaining({ event: expect.objectContaining({ type: "approval-request", toolCallId: "stop-1" }) }),
    );
    await session.cancel();
  });

  it("keeps project-skill history tainted while it remains in model context", async () => {
    const events: ThreadEventEnvelope[] = [];
    const input = { id: "c1" };
    let turn = 0;
    const factory: OmaAgentSessionAdapterFactory = () => ({
      name: "restored-project-skill-taint",
      async chat() {
        turn += 1;
        return turn === 1
          ? response([{ type: "tool_use", id: "stop-1", name: "stopContainer", input }])
          : response([{ type: "text", text: "done" }]);
      },
      async *stream() {},
    });
    const restoredContext = {
      providerId: "openrouter",
      model: "test-model",
      capturedAt: 1,
      window: { status: "unknown" as const },
      sections: [],
      totals: { characters: 0, estimatedTokens: 0 },
      sources: [{ kind: "skill" as const, trust: "project" as const, characters: 25 }],
      tools: [],
      permissionMode: "remember" as const,
      truncation: { applied: false, omittedMessages: 0 },
    };
    const task = {
      ...TASK,
      permissionMode: "remember",
      permissions: {
        version: "2.0.0",
        status: "ok",
        path: "/permissions.json",
        allowed: [toolRule(PERMISSION_CONTEXT, "stopContainer", input)],
        blocked: [],
      },
      execution: { engineOps: { stopContainer: async () => {} } },
    } as unknown as AgentSessionTaskSettings;
    const session = makeCreateOmaAgentSession(factory)(
      makeOptions((event) => events.push(event), {
        taskSettings: task,
        view: { threadId: "session-1", phase: "idle", lastSeq: 1, timeline: [], context: restoredContext },
      }),
    );

    await session.submit({ id: "m1", content: "continue", createdAt: 1 });
    await waitFor(() => events.some(({ event }) => event.type === "tool-start" || event.type === "approval-request"));

    expect(events.some(({ event }) => event.type === "approval-request")).toBe(true);
    await session.cancel();
  });

  it("preserves a partial assistant turn and redirects the same task on mid-model steering", async () => {
    const events: ThreadEventEnvelope[] = [];
    const calls: LLMMessage[][] = [];
    let turn = 0;
    const factory: OmaAgentSessionAdapterFactory = (_task, observer) => ({
      name: "steering",
      async chat(messages, options) {
        calls.push(structuredClone(messages) as LLMMessage[]);
        turn += 1;
        if (turn === 1) {
          observer.onToken("partial", messages);
          await new Promise<void>((resolve) => options.abortSignal?.addEventListener("abort", () => resolve()));
          throw new DOMException("Aborted", "AbortError");
        }
        observer.onToken("redirected", messages);
        return response([{ type: "text", text: "redirected" }]);
      },
      async *stream() {},
    });
    const session = makeCreateOmaAgentSession(factory)(makeOptions((event) => events.push(event)));

    const first = await session.submit({ id: "m1", content: "one", createdAt: 1 });
    await waitFor(() => events.some(({ event }) => event.type === "assistant-delta"));
    const steer = await session.submit({ id: "m2", content: "two", createdAt: 2 });
    expect(first.taskId).toBe(steer.taskId);
    expect(steer.mode).toBe("interrupting");
    await waitForTerminal(events);

    expect(events).toContainEqual(
      expect.objectContaining({ event: expect.objectContaining({ type: "assistant-end", status: "interrupted" }) }),
    );
    expect(events.filter(({ event }) => event.type === "task-complete")).toHaveLength(1);
    expect(JSON.stringify(calls[1])).toContain("partial");
    expect(JSON.stringify(calls[1])).toContain("two");
  });

  it("queues steering during a tool and injects it before OMA's next model call", async () => {
    const events: ThreadEventEnvelope[] = [];
    const calls: LLMMessage[][] = [];
    let turn = 0;
    const factory: OmaAgentSessionAdapterFactory = (_task, observer) => ({
      name: "tool-steering",
      async chat(messages) {
        calls.push(structuredClone(messages) as LLMMessage[]);
        turn += 1;
        if (turn === 1) {
          return response([{ type: "tool_use", id: "tool-1", name: "listContainers", input: {} }]);
        }
        observer.onToken("done", messages);
        return response([{ type: "text", text: "done" }]);
      },
      async *stream() {},
    });
    const task = {
      ...TASK,
      permissionMode: "allow",
      execution: {
        engineOps: { listContainers: async () => new Promise((resolve) => setTimeout(() => resolve([]), 50)) },
      },
    } as unknown as AgentSessionTaskSettings;
    const session = makeCreateOmaAgentSession(factory)(
      makeOptions((event) => events.push(event), { taskSettings: task }),
    );

    await session.submit({ id: "m1", content: "list", createdAt: 1 });
    await waitFor(() => events.some(({ event }) => event.type === "tool-start"));
    const steer = await session.submit({ id: "m2", content: "only running", createdAt: 2 });
    expect(steer.mode).toBe("queued");
    await waitForTerminal(events);

    expect(JSON.stringify(calls[1])).toContain("only running");
    expect(events.filter(({ event }) => event.type === "task-complete")).toHaveLength(1);
  });

  it("uses the app approval gate and preserves OMA tool-call ids in UI events", async () => {
    const events: ThreadEventEnvelope[] = [];
    let stopped = false;
    let turn = 0;
    const factory: OmaAgentSessionAdapterFactory = (_task, observer: OmaAgentSessionAdapterObserver): LLMAdapter => ({
      name: "tools",
      async chat(messages) {
        turn += 1;
        if (turn === 1) {
          return response([{ type: "tool_use", id: "provider-call-1", name: "stopContainer", input: { id: "abc" } }]);
        }
        observer.onToken("stopped", messages);
        return response([{ type: "text", text: "stopped" }]);
      },
      async *stream() {},
    });
    const task = {
      ...TASK,
      execution: {
        engineOps: {
          stopContainer: async ({ id }: { id: string }) => {
            stopped = id === "abc";
            return true;
          },
        },
      },
    } as unknown as AgentSessionTaskSettings;
    const session = makeCreateOmaAgentSession(factory)(
      makeOptions((event) => events.push(event), { taskSettings: task }),
    );

    await session.submit({ id: "m1", content: "stop abc", createdAt: 1 });
    await waitFor(() => events.some(({ event }) => event.type === "approval-request"));
    const approval = events.find(({ event }) => event.type === "approval-request");
    if (approval?.event.type !== "approval-request") throw new Error("approval missing");
    expect(approval.event.toolCallId).toBe("provider-call-1");
    await session.resolveApproval(approval.event.approvalId, "allow");
    await waitForTerminal(events);

    expect(stopped).toBe(true);
    expect(events.filter(({ event }) => event.type === "tool-start")).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({ type: "tool-result", toolCallId: "provider-call-1", ok: true }),
      }),
    );
  });

  it("does not execute an approved tool when its remembered decision cannot be persisted", async () => {
    const events: ThreadEventEnvelope[] = [];
    let stopped = false;
    const factory: OmaAgentSessionAdapterFactory = () => ({
      name: "permission-write-failure",
      async chat() {
        return response([{ type: "tool_use", id: "stop-1", name: "stopContainer", input: { id: "abc" } }]);
      },
      async *stream() {},
    });
    const task = {
      ...TASK,
      permissionMode: "remember",
      execution: {
        engineOps: {
          stopContainer: async () => {
            stopped = true;
          },
        },
      },
    } as unknown as AgentSessionTaskSettings;
    const session = makeCreateOmaAgentSession(factory)(
      makeOptions((event) => events.push(event), {
        taskSettings: task,
        permissionsStore: {
          load: async () => ({
            version: "2.0.0",
            status: "ok",
            path: "/permissions.json",
            allowed: [],
            blocked: [],
          }),
          addCommand: async () => {
            throw new Error("disk full");
          },
          removeCommand: async () => ({
            version: "2.0.0",
            status: "ok",
            path: "/permissions.json",
            allowed: [],
            blocked: [],
          }),
        },
      }),
    );

    await session.submit({ id: "m1", content: "stop abc", createdAt: 1 });
    await waitFor(() => events.some(({ event }) => event.type === "approval-request"));
    const approval = events.find(({ event }) => event.type === "approval-request");
    if (approval?.event.type !== "approval-request") throw new Error("approval missing");
    await session.resolveApproval(approval.event.approvalId, "allow");
    await waitForTerminal(events);

    expect(stopped).toBe(false);
    expect(events.some(({ event }) => event.type === "tool-start")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ event: expect.objectContaining({ type: "error", message: "disk full" }) }),
    );
  });

  it("offloads large tool results before emitting a bounded timeline event", async () => {
    const events: ThreadEventEnvelope[] = [];
    const calls: LLMMessage[][] = [];
    let turn = 0;
    const factory: OmaAgentSessionAdapterFactory = (_task, observer) => ({
      name: "large-tool-result",
      async chat(messages) {
        calls.push(structuredClone(messages) as LLMMessage[]);
        turn += 1;
        if (turn === 1) {
          return response([{ type: "tool_use", id: "read-1", name: "readFile", input: { path: "large.log" } }]);
        }
        observer.onToken("stored", messages);
        return response([{ type: "text", text: "stored" }]);
      },
      async *stream() {},
    });
    const task = {
      ...TASK,
      permissionMode: "allow",
      execution: {
        workspaceAccess: {
          read: async () => "x".repeat(40 * 1024),
        },
      },
    } as unknown as AgentSessionTaskSettings;
    const stored: Array<{ threadId: string; toolCallId: string; content: string; byteLength: number }> = [];
    const session = makeCreateOmaAgentSession(factory)(
      makeOptions((event) => events.push(event), {
        taskSettings: task,
        storeToolArtifact: async (input) => {
          stored.push(input);
          return {
            id: "artifact-1",
            mediaType: "application/json",
            byteLength: input.byteLength,
            fingerprint: "a".repeat(64),
          };
        },
      }),
    );

    await session.submit({ id: "m1", content: "read the log", createdAt: 1 });
    await waitForTerminal(events);

    expect(stored).toEqual([
      expect.objectContaining({ threadId: "session-1", toolCallId: "read-1", tool: "readFile" }),
    ]);
    expect(stored[0].content.length).toBeGreaterThan(32 * 1024);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          type: "tool-result",
          toolCallId: "read-1",
          result: expect.objectContaining({ truncated: true }),
          artifact: expect.objectContaining({ id: "artifact-1" }),
        }),
      }),
    );
    expect(JSON.stringify(calls[1])).toContain('\\"artifactId\\":\\"artifact-1\\"');
  });

  it("settles a cancelled OMA turn as stopped without losing streamed partial output", async () => {
    const events: ThreadEventEnvelope[] = [];
    const factory: OmaAgentSessionAdapterFactory = (_task, observer) => ({
      name: "cancel",
      async chat(messages, options) {
        observer.onToken("part", messages);
        await new Promise<void>((resolve) => options.abortSignal?.addEventListener("abort", () => resolve()));
        throw new DOMException("Aborted", "AbortError");
      },
      async *stream() {},
    });
    const session = makeCreateOmaAgentSession(factory)(makeOptions((event) => events.push(event)));

    await session.submit({ id: "m1", content: "go", createdAt: 1 });
    await waitFor(() => events.some(({ event }) => event.type === "assistant-delta"));
    await session.cancel();
    await waitForTerminal(events);

    expect(events).toContainEqual(
      expect.objectContaining({ event: expect.objectContaining({ type: "assistant-end", status: "stopped" }) }),
    );
    expect(events.map(({ event }) => event.type)).toContain("task-stopped");
    expect(session.snapshot().phase).toBe("idle");
  });
});
