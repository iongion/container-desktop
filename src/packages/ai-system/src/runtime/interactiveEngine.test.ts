import type { LLMAdapter, LLMMessage, StreamEvent } from "@open-multi-agent/core";
import { describe, expect, it } from "vitest";
import type { ChatEventEnvelope } from "@/ai-system/core/chatEvents";
import type { AgentSessionCreationOptions, AgentSessionTaskSettings } from "@/ai-system/core/types";
import { makeCreateAgentSession } from "./interactiveEngine";

// `calls` records the history handed to each model call. The engine passes its LIVE modelHistory array, so every
// capture is cloned — otherwise all entries alias one array that keeps mutating and assertions on it prove nothing.
function scriptedAdapter(chunks: string[], opts?: { delayMs?: number; calls?: LLMMessage[][] }): LLMAdapter {
  return {
    name: "scripted",
    async chat() {
      throw new Error("unused");
    },
    async *stream(messages, options): AsyncIterable<StreamEvent> {
      opts?.calls?.push(structuredClone(messages) as LLMMessage[]);
      for (const chunk of chunks) {
        if (options.abortSignal?.aborted) return;
        if (opts?.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (options.abortSignal?.aborted) return;
        yield { type: "text", data: chunk };
      }
      yield { type: "done", data: {} };
    },
  };
}

const TASK = {
  resolved: { model: "test-model" },
  providerFetch: globalThis.fetch,
  system: "system prompt",
  permissionMode: "ask",
  execution: {},
} as unknown as AgentSessionTaskSettings;

function makeOptions(emit: (e: ChatEventEnvelope) => void): AgentSessionCreationOptions {
  return { sessionId: "s1", history: [], taskSettings: TASK, emit };
}

async function waitFor(predicate: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function waitForTerminal(events: ChatEventEnvelope[]): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (
      events.some(
        (e) => e.event.type === "task-complete" || e.event.type === "task-stopped" || e.event.type === "error",
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("makeCreateAgentSession (owned interactive loop)", () => {
  it("emits the streaming envelope sequence with monotonic seq and folds the final view", async () => {
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => scriptedAdapter(["Hello", " world"]))(
      makeOptions((e) => events.push(e)),
    );

    const result = await session.submit({ id: "m1", content: "hi", createdAt: 1 });
    expect(result).toMatchObject({ accepted: true, mode: "started", phase: "model" });
    await waitForTerminal(events);

    expect(events.map((e) => e.event.type)).toEqual([
      "phase-changed",
      "user-message",
      "assistant-start",
      "assistant-delta",
      "assistant-delta",
      "assistant-end",
      "task-complete",
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const envelope of events) expect(envelope.version).toBe(1);

    const view = session.snapshot();
    expect(view.phase).toBe("idle");
    expect(view.timeline).toHaveLength(2);
    const assistant = view.timeline.find((t) => t.kind === "message" && t.role === "assistant");
    expect(assistant).toMatchObject({ status: "complete", content: "Hello world" });

    const durable = session.durableSnapshot();
    expect(durable.modelHistory).toHaveLength(2);
  });

  it("accepts a concurrent submit by steering the running task rather than dropping it", async () => {
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => scriptedAdapter(["a", "b", "c"], { delayMs: 20 }))(
      makeOptions((e) => events.push(e)),
    );
    const first = await session.submit({ id: "m1", content: "one", createdAt: 1 });
    const second = await session.submit({ id: "m2", content: "two", createdAt: 2 });
    expect(first.mode).toBe("started");
    // Landing during the model call, it interrupts that call instead of waiting behind it.
    expect(second.mode).toBe("interrupting");
    await waitForTerminal(events);
  });

  it("stops mid-stream on cancel, ending the assistant message as stopped", async () => {
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => scriptedAdapter(["x", "y", "z", "w"], { delayMs: 30 }))(
      makeOptions((e) => events.push(e)),
    );
    await session.submit({ id: "m1", content: "go", createdAt: 1 });
    await new Promise((r) => setTimeout(r, 45));
    await session.cancel();
    await waitForTerminal(events);

    const types = events.map((e) => e.event.type);
    expect(types).toContain("task-stopped");
    const assistantEnd = events.find((e) => e.event.type === "assistant-end");
    expect(assistantEnd?.event).toMatchObject({ status: "stopped" });
    expect(session.snapshot().phase).toBe("idle");
  });
});

function toolCallingAdapter(toolName: string, input: Record<string, unknown>, calls?: LLMMessage[][]): LLMAdapter {
  return {
    name: "toolcaller",
    async chat() {
      throw new Error("unused");
    },
    async *stream(messages): AsyncIterable<StreamEvent> {
      calls?.push(structuredClone(messages) as LLMMessage[]);
      const ranTool = messages.some((m) => m.role === "user" && m.content.some((b) => b.type === "tool_result"));
      if (ranTool) {
        yield { type: "text", data: "All done." };
        yield { type: "done", data: {} };
        return;
      }
      yield { type: "tool_use", data: { type: "tool_use", id: "call-1", name: toolName, input } };
      yield { type: "done", data: {} };
    },
  };
}

function taskWithOps(engineOps: unknown, mode: "ask" | "remember" | "allow"): AgentSessionTaskSettings {
  return {
    resolved: { model: "test-model" },
    providerFetch: globalThis.fetch,
    system: "system prompt",
    permissionMode: mode,
    execution: { engineOps },
  } as unknown as AgentSessionTaskSettings;
}

async function waitForApproval(events: ChatEventEnvelope[]): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const req = events.find((e) => e.event.type === "approval-request");
    if (req && req.event.type === "approval-request") return req.event.approvalId;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("no approval-request emitted");
}

describe("makeCreateAgentSession (multi-step tool loop)", () => {
  it("runs an ungated read tool through EngineOps and renders a tool-result, then answers", async () => {
    const containers = [{ Id: "abc123", Name: "web", Image: "nginx", State: "running" }];
    const engineOps = { listContainers: async () => containers };
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => toolCallingAdapter("listContainers", {}))({
      sessionId: "s1",
      history: [],
      taskSettings: taskWithOps(engineOps, "allow"),
      emit: (e) => events.push(e),
    });
    await session.submit({ id: "m1", content: "list my containers", createdAt: 1 });
    await waitForTerminal(events);

    const types = events.map((e) => e.event.type);
    expect(types).toContain("tool-start");
    expect(types).toContain("tool-result");
    expect(types).not.toContain("approval-request");
    const result = events.find((e) => e.event.type === "tool-result");
    expect(result?.event).toMatchObject({ tool: "listContainers", ok: true });
    const timeline = session.snapshot().timeline;
    expect(timeline.some((t) => t.kind === "tool" && t.tool === "listContainers" && t.status === "complete")).toBe(
      true,
    );
  });

  it("gates a mutating tool: emits approval-request and runs after allow", async () => {
    let stopped = "";
    const engineOps = {
      stopContainer: async (a: { id: string }) => {
        stopped = a.id;
        return true;
      },
    };
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => toolCallingAdapter("stopContainer", { id: "abc123" }))({
      sessionId: "s1",
      history: [],
      taskSettings: taskWithOps(engineOps, "ask"),
      emit: (e) => events.push(e),
    });
    await session.submit({ id: "m1", content: "stop the web container", createdAt: 1 });
    const approvalId = await waitForApproval(events);
    await session.resolveApproval(approvalId, "allow");
    await waitForTerminal(events);

    expect(stopped).toBe("abc123");
    const types = events.map((e) => e.event.type);
    expect(types).toContain("approval-resolved");
    expect(types).toContain("tool-result");
  });

  it("gates a mutating tool: reject skips execution", async () => {
    let called = false;
    const engineOps = {
      stopContainer: async () => {
        called = true;
        return true;
      },
    };
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => toolCallingAdapter("stopContainer", { id: "abc123" }))({
      sessionId: "s1",
      history: [],
      taskSettings: taskWithOps(engineOps, "ask"),
      emit: (e) => events.push(e),
    });
    await session.submit({ id: "m1", content: "stop it", createdAt: 1 });
    const approvalId = await waitForApproval(events);
    await session.resolveApproval(approvalId, "reject");
    await waitForTerminal(events);

    expect(called).toBe(false);
    expect(events.map((e) => e.event.type)).toContain("tool-denied");
  });
});

function taskWithWorkspace(workspaceAccess: unknown, mode: "ask" | "remember" | "allow"): AgentSessionTaskSettings {
  return {
    resolved: { model: "test-model" },
    providerFetch: globalThis.fetch,
    system: "system prompt",
    permissionMode: mode,
    execution: { workspaceAccess },
  } as unknown as AgentSessionTaskSettings;
}

function capturingAdapter(onTools: (names: string[]) => void): LLMAdapter {
  return {
    name: "capture",
    async chat() {
      throw new Error("unused");
    },
    async *stream(_messages, options): AsyncIterable<StreamEvent> {
      onTools((options.tools ?? []).map((tool) => tool.name));
      yield { type: "text", data: "ok" };
      yield { type: "done", data: {} };
    },
  };
}

describe("makeCreateAgentSession (workspace tool loop)", () => {
  it("runs an ungated readFile through the workspace port and renders a tool-result", async () => {
    const workspace = { read: async (path: string) => `line 1\nline 2 of ${path}` };
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => toolCallingAdapter("readFile", { path: "src/a.ts" }))({
      sessionId: "s1",
      history: [],
      taskSettings: taskWithWorkspace(workspace, "allow"),
      emit: (e) => events.push(e),
    });
    await session.submit({ id: "m1", content: "read src/a.ts", createdAt: 1 });
    await waitForTerminal(events);

    const types = events.map((e) => e.event.type);
    expect(types).toContain("tool-start");
    expect(types).toContain("tool-result");
    expect(types).not.toContain("approval-request");
    const result = events.find((e) => e.event.type === "tool-result");
    expect(result?.event).toMatchObject({ tool: "readFile", ok: true });
  });

  it("gates editFile: emits approval-request and applies the edit after allow", async () => {
    let edited: Record<string, unknown> | null = null;
    const workspace = {
      edit: async (path: string, oldString: string, newString: string) => {
        edited = { path, oldString, newString };
        return { path, before: oldString, after: newString, replacements: 1 };
      },
    };
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() =>
      toolCallingAdapter("editFile", { path: "a.ts", oldString: "foo", newString: "bar" }),
    )({
      sessionId: "s1",
      history: [],
      taskSettings: taskWithWorkspace(workspace, "ask"),
      emit: (e) => events.push(e),
    });
    await session.submit({ id: "m1", content: "rename foo to bar", createdAt: 1 });
    const approvalId = await waitForApproval(events);
    await session.resolveApproval(approvalId, "allow");
    await waitForTerminal(events);

    expect(edited).toMatchObject({ path: "a.ts", oldString: "foo", newString: "bar" });
    expect(events.map((e) => e.event.type)).toContain("tool-result");
  });

  it("merges container and workspace toolsets, offering both to the adapter", async () => {
    let offered: string[] = [];
    const task = {
      resolved: { model: "test-model" },
      providerFetch: globalThis.fetch,
      system: "system prompt",
      permissionMode: "allow",
      execution: {
        engineOps: { listContainers: async () => [] },
        workspaceAccess: { read: async () => "" },
      },
    } as unknown as AgentSessionTaskSettings;
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() =>
      capturingAdapter((names) => {
        offered = names;
      }),
    )({ sessionId: "s1", history: [], taskSettings: task, emit: (e) => events.push(e) });
    await session.submit({ id: "m1", content: "hi", createdAt: 1 });
    await waitForTerminal(events);

    expect(offered).toContain("listContainers");
    expect(offered).toContain("readFile");
    expect(offered).toContain("editFile");
  });
});

// A two-step adapter: it calls `first` on the opening turn, then `second` once a tool result is in history.
function twoToolAdapter(first: string, second: string, input: Record<string, unknown>): LLMAdapter {
  return {
    name: "twotool",
    async chat() {
      throw new Error("unused");
    },
    async *stream(messages): AsyncIterable<StreamEvent> {
      const results = messages.filter((m) => m.role === "user" && m.content.some((b) => b.type === "tool_result"));
      if (results.length === 0) {
        yield { type: "tool_use", data: { type: "tool_use", id: "call-1", name: first, input: {} } };
        yield { type: "done", data: {} };
        return;
      }
      if (results.length === 1) {
        yield { type: "tool_use", data: { type: "tool_use", id: "call-2", name: second, input } };
        yield { type: "done", data: {} };
        return;
      }
      yield { type: "text", data: "Done." };
      yield { type: "done", data: {} };
    },
  };
}

describe("makeCreateAgentSession — injection-resistant approvals", () => {
  const remembered = {
    version: "1.0.0",
    status: "ok" as const,
    path: "/tmp/p.json",
    allowed: [{ program: "tool:stopContainer", args: [JSON.stringify({ id: "abc123" })] }],
    blocked: [],
  };

  function taskWith(permissions: unknown, engineOps: unknown): AgentSessionTaskSettings {
    return {
      resolved: { model: "test-model" },
      providerFetch: globalThis.fetch,
      system: "system prompt",
      permissionMode: "remember",
      permissions,
      execution: { engineOps },
    } as unknown as AgentSessionTaskSettings;
  }

  it("honors a remembered allow when the turn has NOT ingested untrusted content", async () => {
    let stopped = false;
    const engineOps = {
      stopContainer: async () => {
        stopped = true;
        return true;
      },
    };
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => toolCallingAdapter("stopContainer", { id: "abc123" }))({
      sessionId: "s1",
      history: [],
      taskSettings: taskWith(remembered, engineOps),
      emit: (e) => events.push(e),
    });
    await session.submit({ id: "m1", content: "stop it", createdAt: 1 });
    await waitForTerminal(events);

    expect(stopped).toBe(true);
    expect(events.map((e) => e.event.type)).not.toContain("approval-request");
  });

  it("re-prompts for that same remembered allow once a tool result has entered the turn", async () => {
    let stopped = false;
    const engineOps = {
      listContainers: async () => [],
      stopContainer: async () => {
        stopped = true;
        return true;
      },
    };
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => twoToolAdapter("listContainers", "stopContainer", { id: "abc123" }))({
      sessionId: "s1",
      history: [],
      taskSettings: taskWith(remembered, engineOps),
      emit: (e) => events.push(e),
    });
    await session.submit({ id: "m1", content: "check then stop", createdAt: 1 });
    // The remembered verdict must NOT auto-run now — the model may be echoing what it just read.
    const approvalId = await waitForApproval(events);
    expect(stopped).toBe(false);
    await session.resolveApproval(approvalId, "allow");
    await waitForTerminal(events);
    expect(stopped).toBe(true);
  });
});

describe("makeCreateAgentSession — conversation migration", () => {
  const task = {
    resolved: { model: "test-model" },
    providerFetch: globalThis.fetch,
    system: "system prompt",
    permissionMode: "ask",
    execution: {},
  } as unknown as AgentSessionTaskSettings;

  const history = [
    { id: "h1", role: "user" as const, content: "hello", createdAt: 1 },
    { id: "h2", role: "assistant" as const, content: "hi there", createdAt: 2 },
  ];

  function seededHistory(modelHistory: unknown[]): unknown[] {
    const session = makeCreateAgentSession(() => scriptedAdapter(["ok"]))({
      sessionId: "s1",
      history,
      modelHistory,
      taskSettings: task,
      emit: () => undefined,
    });
    return session.durableSnapshot().modelHistory;
  }

  it("keeps a model history this engine can speak", () => {
    const own = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
    expect(seededHistory(own)).toEqual(own);
  });

  it("DISCARDS a whole history from the retired engine and re-seeds from the visible transcript", () => {
    // The old AI-SDK engine persisted hyphenated parts; one foreign entry invalidates the whole transcript,
    // because keeping the rest would break tool-call/result pairing and the provider would reject the turn.
    const legacy = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "x", toolName: "listContainers", args: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "x", result: {} }] },
    ];
    expect(seededHistory(legacy)).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ]);
  });

  it("re-seeds from the transcript when there is no persisted model history at all", () => {
    expect(seededHistory([])).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ]);
  });
});

describe("makeCreateAgentSession — steering", () => {
  it("splices a message typed during a tool call into the same task without interrupting it", async () => {
    const events: ChatEventEnvelope[] = [];
    const calls: LLMMessage[][] = [];
    // Parks inside the tool so the submit below lands squarely in the tool phase.
    const engineOps = { listContainers: async () => new Promise((r) => setTimeout(() => r([]), 80)) };
    const session = makeCreateAgentSession(() => toolCallingAdapter("listContainers", {}, calls))({
      sessionId: "s1",
      history: [],
      taskSettings: taskWithOps(engineOps, "allow"),
      emit: (e) => events.push(e),
    });

    await session.submit({ id: "m1", content: "list my containers", createdAt: 1 });
    // tool-start is emitted before the tool runs, so this lands mid-tool.
    await waitFor(() => events.some((e) => e.event.type === "tool-start"), 2000);
    const steer = await session.submit({ id: "m2", content: "only running ones", createdAt: 2 });
    // A tool is already in flight, so it settles exactly once — there is nothing to interrupt.
    expect(steer.mode).toBe("queued");
    await waitFor(() => events.some((e) => e.event.type === "task-complete"), 4000);

    expect(events.some((e) => e.event.type === "assistant-end" && e.event.status === "interrupted")).toBe(false);
    expect(events.filter((e) => e.event.type === "task-complete")).toHaveLength(1);
    expect(events.some((e) => e.event.type === "user-message-applied" && e.event.id === "m2")).toBe(true);
    // The steer rode in on the tool-result turn: two user turns, not three, since providers reject consecutive ones.
    const lastCall = calls[calls.length - 1];
    expect(JSON.stringify(lastCall)).toContain("only running ones");
    expect(lastCall.filter((m) => m.role === "user")).toHaveLength(2);
  });

  it("interrupts the streaming turn and steers it inside the same task", async () => {
    const events: ChatEventEnvelope[] = [];
    const calls: LLMMessage[][] = [];
    const session = makeCreateAgentSession(() => scriptedAdapter(["part", "ial"], { delayMs: 40, calls }))(
      makeOptions((e) => events.push(e)),
    );

    await session.submit({ id: "m1", content: "one", createdAt: 1 });
    // Steer only once the model is genuinely mid-stream, which is the case the docs describe.
    await waitFor(() => events.some((e) => e.event.type === "assistant-delta"), 2000);
    await session.submit({ id: "m2", content: "two", createdAt: 2 });
    await waitFor(() => events.some((e) => e.event.type === "task-complete"), 4000);

    // The partial reply freezes as Interrupted — the status AssistantConversation already renders.
    expect(events.some((e) => e.event.type === "assistant-end" && e.event.status === "interrupted")).toBe(true);
    // Steering REDIRECTS the running task; it must not defer to a second one.
    expect(events.filter((e) => e.event.type === "task-complete")).toHaveLength(1);
    // The steer reached the model, and the interrupted partial text was kept as context.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(calls[calls.length - 1])).toContain("two");
    expect(JSON.stringify(calls[calls.length - 1])).toContain("part");
  });

  it("discards a message once the pending queue is full rather than growing without bound", async () => {
    const events: ChatEventEnvelope[] = [];
    const session = makeCreateAgentSession(() => scriptedAdapter(["x"], { delayMs: 400 }))(
      makeOptions((e) => events.push(e)),
    );
    await session.submit({ id: "m1", content: "start", createdAt: 1 });
    for (let index = 0; index < 17; index += 1) {
      await session.submit({ id: `q${index}`, content: `queued ${index}`, createdAt: index + 2 });
    }
    const discarded = events.filter((e) => e.event.type === "user-message" && e.event.delivery === "discarded");
    expect(discarded.length).toBeGreaterThan(0);
    await session.cancel();
  });
});
