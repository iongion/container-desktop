import { describe, expect, it, vi } from "vitest";
import type { ThreadEvent, ThreadEventEnvelope } from "@/ai-system/core/threadEvents";
import { emptyThreadView, reduceThreadEvent, threadTimelineMessageContent } from "@/ai-system/core/threadReducer";
import type { ThreadSummary } from "@/ai-system/core/threads";
import type { IAI } from "@/ai-system/host/aiClientBridge";
import { createAIStore } from "@/ai-system/ui/core/stores/aiStore";

const event = (threadId: string, seq: number, value: ThreadEvent): ThreadEventEnvelope => ({
  version: 1,
  threadId,
  taskId: "task-1",
  segmentId: "segment-1",
  seq,
  event: value,
});

function createDeps(overrides: Partial<IAI> = {}) {
  const threads = new Map<string, ThreadSummary>();
  const ai = {
    listThreads: vi.fn(async () => [...threads.values()]),
    createThread: vi.fn(async (request) => {
      const now = Date.now();
      const thread: ThreadSummary = {
        ...request,
        createdAt: now,
        updatedAt: now,
        phase: "idle",
        lastSeq: 0,
      };
      threads.set(thread.id, thread);
      return thread;
    }),
    submitToThread: vi.fn(async () => ({
      accepted: true as const,
      threadId: "thread-1",
      taskId: "task-1",
      mode: "started" as const,
      phase: "model" as const,
    })),
    getThreadSnapshot: vi.fn(async () => null),
    resolveThreadApproval: vi.fn(async () => ({ accepted: true, phase: "model" as const })),
    stopThread: vi.fn(async () => ({ ok: true as const })),
    deleteThread: vi.fn(async (id) => {
      threads.delete(id);
      return { ok: true as const };
    }),
    renameThread: vi.fn(async (id, title) => {
      const thread = threads.get(id);
      if (!thread) throw new Error("AI: Thread not found");
      const renamed = { ...thread, title, titleOrigin: "user" as const, updatedAt: Date.now() };
      threads.set(id, renamed);
      return renamed;
    }),
    configureThread: vi.fn(async (id, patch) => {
      const thread = threads.get(id);
      if (!thread) throw new Error("AI: Thread not found");
      const configured = { ...thread, ...patch, updatedAt: Date.now() };
      threads.set(id, configured);
      return configured;
    }),
    ...overrides,
  } as unknown as IAI;
  const log = { error: vi.fn() };
  return { ai, log, collectBundle: vi.fn(() => ({ engine: "docker" })) };
}

describe("AI store thread-event projection", () => {
  it("previews a branch without mutation and selects the confirmed branch with its history", async () => {
    const previewThreadBranch = vi.fn(async (threadId: string) => ({
      source: {
        id: threadId,
        title: "Source",
        createdAt: 1,
        updatedAt: 1,
        phase: "idle" as const,
        lastSeq: 2,
      },
      checkpoints: [
        { id: "checkpoint-1", messageId: "message-1", createdAt: 1, timelineLength: 1, modelHistoryLength: 1 },
      ],
      bindings: { permissionMode: "ask" as const, contextPolicy: "application" as const, target: "host" as const },
      environmentRestored: false as const,
    }));
    const branchThread = vi.fn(async () => ({
      thread: {
        id: "thread-branch",
        title: "Source branch",
        titleOrigin: "user" as const,
        createdAt: 2,
        updatedAt: 2,
        phase: "idle" as const,
        lastSeq: 0,
      },
      view: {
        threadId: "thread-branch",
        phase: "idle" as const,
        lastSeq: 0,
        timeline: [
          {
            kind: "message" as const,
            id: "message-branch",
            role: "assistant" as const,
            content: "Inherited answer",
            delivery: "applied" as const,
            status: "complete" as const,
          },
        ],
      },
    }));
    const deps = createDeps({ previewThreadBranch, branchThread });
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    const sourceId = await store.getState().newThread();

    await expect(store.getState().previewThreadBranch(sourceId)).resolves.toMatchObject({
      source: { id: sourceId },
      checkpoints: [{ id: "checkpoint-1" }],
    });
    expect(store.getState().activeThreadId).toBe(sourceId);

    await expect(store.getState().branchThread(sourceId, "checkpoint-1", "Source branch")).resolves.toMatchObject({
      thread: { id: "thread-branch" },
    });
    expect(store.getState().activeThreadId).toBe("thread-branch");
    expect(store.getState().views["thread-branch"].timeline).toEqual([
      expect.objectContaining({ id: "message-branch", content: "Inherited answer" }),
    ]);
    store.dispose();
  });

  it("previews compaction and replaces the active projection without deleting the Thread", async () => {
    const previewThreadCompaction = vi.fn(async (threadId: string) => ({
      thread: {
        id: threadId,
        title: "Long Thread",
        createdAt: 1,
        updatedAt: 1,
        phase: "idle" as const,
        lastSeq: 16,
      },
      plan: {
        source: { historyStart: 0, historyEnd: 8, messageStartId: "message-1", messageEndId: "message-8" },
        sourceHistoryMessages: 8,
        retainedHistoryMessages: 8,
        revision: { lastSeq: 16, modelHistoryLength: 16 },
      },
      providerId: "llamacpp",
      model: "model-1",
    }));
    const compactThread = vi.fn(async (threadId: string) => ({
      thread: {
        id: threadId,
        title: "Long Thread",
        createdAt: 1,
        updatedAt: 2,
        phase: "idle" as const,
        lastSeq: 16,
      },
      view: {
        threadId,
        phase: "idle" as const,
        lastSeq: 16,
        timeline: [
          {
            kind: "message" as const,
            id: "message-16",
            role: "assistant" as const,
            content: "Durable history remains visible",
            delivery: "applied" as const,
            status: "complete" as const,
          },
        ],
      },
      compaction: {
        id: "compaction-1",
        createdAt: 2,
        source: { historyStart: 0, historyEnd: 8, messageStartId: "message-1", messageEndId: "message-8" },
        summary: "The first eight messages established the constraints.",
        providerId: "llamacpp",
        model: "model-1",
        inputTokens: 80,
        outputTokens: 20,
        fingerprint: "a".repeat(64),
        contentTrust: "application" as const,
        tainted: false,
      },
    }));
    const deps = createDeps({ previewThreadCompaction, compactThread });
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    const threadId = await store.getState().newThread();

    const preview = await store.getState().previewThreadCompaction(threadId);
    await expect(
      store.getState().compactThread(threadId, preview.plan.revision, "Preserve constraints."),
    ).resolves.toMatchObject({ compaction: { id: "compaction-1" } });

    expect(compactThread).toHaveBeenCalledWith(threadId, preview.plan.revision, "Preserve constraints.");
    expect(store.getState().activeThreadId).toBe(threadId);
    expect(store.getState().views[threadId].timeline).toEqual([
      expect.objectContaining({ id: "message-16", content: "Durable history remains visible" }),
    ]);
    store.dispose();
  });

  it("applies development fixtures through the actor without exposing internal submission state", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    const threadId = await store.getState().newThread();
    const view = {
      ...emptyThreadView(threadId),
      phase: "model" as const,
      timeline: [{ kind: "message" as const, id: "demo", role: "assistant" as const, content: "fixture" }],
    };

    expect("replaceViewForDev" in store).toBe(true);
    (store as unknown as { replaceViewForDev: (id: string, next: typeof view) => void }).replaceViewForDev(
      threadId,
      view,
    );

    expect(store.getState().views[threadId]).toEqual(view);
    expect("pendingSubmissions" in store.getState()).toBe(false);
    store.dispose();
  });

  it("submits one inserted message without optimistic duplication and accepts its event before the invoke reply", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    await store.getState().newThread();
    const threadId = store.getState().activeThreadId as string;
    (deps.ai.submitToThread as any).mockImplementation(async (request: any) => {
      store
        .getState()
        .applyThreadEvent(event(threadId, 1, { type: "user-message", ...request.message, delivery: "applied" }));
      return {
        accepted: true,
        threadId,
        taskId: "task-1",
        mode: "started",
        phase: "model",
      };
    });

    await store.getState().submitMessage("hello", { providerId: "llamacpp", model: "qwen" });

    const request = (deps.ai.submitToThread as any).mock.calls[0][0];
    expect(request).toMatchObject({ threadId, history: [], providerId: "llamacpp", model: "qwen" });
    expect(store.getState().views[threadId].timeline).toEqual([
      expect.objectContaining({ kind: "message", role: "user", content: "hello", delivery: "applied" }),
    ]);
  });

  it("projects queued/applied input and addressed assistant deltas without stream bindings", () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    store
      .getState()
      .applyThreadEvent(
        event("thread-1", 1, { type: "user-message", id: "user-1", content: "wait", delivery: "queued" }),
      );
    store.getState().applyThreadEvent(event("thread-1", 2, { type: "assistant-start", id: "assistant-1" }));
    store
      .getState()
      .applyThreadEvent(event("thread-1", 3, { type: "assistant-delta", id: "assistant-1", text: "Part" }));
    store.getState().applyThreadEvent(event("thread-1", 4, { type: "user-message-applied", id: "user-1" }));
    store
      .getState()
      .applyThreadEvent(event("thread-1", 5, { type: "assistant-end", id: "assistant-1", status: "interrupted" }));

    expect(store.getState().views["thread-1"].timeline).toEqual([
      expect.objectContaining({ id: "user-1", delivery: "applied" }),
      expect.objectContaining({ id: "assistant-1", content: "Part", status: "interrupted" }),
    ]);
  });

  it("recovers an event-sequence gap from the authoritative actor snapshot", async () => {
    let snapshot = emptyThreadView("thread-1");
    snapshot = reduceThreadEvent(
      snapshot,
      event("thread-1", 1, { type: "user-message", id: "user-1", content: "hi", delivery: "applied" }),
    ).view;
    snapshot = reduceThreadEvent(snapshot, event("thread-1", 2, { type: "assistant-start", id: "assistant-1" })).view;
    snapshot = reduceThreadEvent(
      snapshot,
      event("thread-1", 3, { type: "assistant-delta", id: "assistant-1", text: "Recovered" }),
    ).view;
    const deps = createDeps({ getThreadSnapshot: vi.fn(async () => snapshot) });
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });

    store
      .getState()
      .applyThreadEvent(event("thread-1", 3, { type: "assistant-delta", id: "assistant-1", text: "Recovered" }));
    await vi.waitFor(() => expect(store.getState().views["thread-1"]?.lastSeq).toBe(3));
    const recovered = store.getState().views["thread-1"];
    const assistantIndex = recovered.timeline.findIndex((item) => item.kind === "message" && item.id === "assistant-1");
    const assistant = recovered.timeline[assistantIndex];
    expect(assistant?.kind).toBe("message");
    if (assistant?.kind === "message") {
      expect(threadTimelineMessageContent(recovered, assistant, assistantIndex)).toBe("Recovered");
    }
  });

  it("awaits approval resolution and stop while reflecting resolving state locally", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolveThreadApproval = vi.fn(async () => {
      await pending;
      return { accepted: true, phase: "model" as const };
    });
    const deps = createDeps({ resolveThreadApproval });
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    store.getState().applyThreadEvent(
      event("thread-1", 1, {
        type: "approval-request",
        approvalId: "approval-1",
        toolCallId: "tool-1",
        tool: "runCommand",
        title: "podman stop web",
        args: { program: "podman", args: ["stop", "web"] },
        reason: "Requires approval",
      }),
    );
    store.getState().setActiveThread("thread-1");

    const resolving = store.getState().resolveApproval("approval-1", "allow");
    expect(store.getState().views["thread-1"].timeline).toContainEqual(
      expect.objectContaining({ kind: "approval", status: "resolving" }),
    );
    release();
    await resolving;
    expect(resolveThreadApproval).toHaveBeenCalledWith({
      threadId: "thread-1",
      approvalId: "approval-1",
      decision: "allow",
    });
    await store.getState().cancel();
    expect(deps.ai.stopThread).toHaveBeenCalledWith("thread-1");
  });

  it("deletes a thread: disposes the host actor, drops persisted prose, and reselects", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    await vi.waitFor(() => expect(store.getState().activeThreadId).not.toBeNull());
    const first = store.getState().activeThreadId as string;
    await store.getState().newThread();
    const second = store.getState().activeThreadId as string;

    await expect(store.getState().deleteThread(second)).resolves.toEqual({ ok: true });

    expect(deps.ai.deleteThread).toHaveBeenCalledWith(second);
    expect(store.getState().threads.map((s) => s.id)).toEqual([first]);
    expect(store.getState().views[second]).toBeUndefined();
    expect(store.getState().activeThreadId).toBe(first);
    expect(await deps.ai.listThreads()).toEqual([expect.objectContaining({ id: first })]);
  });

  it("renames a thread through the host and updates its local summary", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    await vi.waitFor(() => expect(store.getState().activeThreadId).not.toBeNull());
    const threadId = store.getState().activeThreadId as string;

    await store.getState().renameThread(threadId, "Container cleanup");

    expect(deps.ai.renameThread).toHaveBeenCalledWith(threadId, "Container cleanup");
    expect(store.getState().threads).toContainEqual(
      expect.objectContaining({ id: threadId, title: "Container cleanup", titleOrigin: "user" }),
    );
  });

  it("configures Thread access and reasoning through the host and updates its local summary", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    await vi.waitFor(() => expect(store.getState().activeThreadId).not.toBeNull());
    const threadId = store.getState().activeThreadId as string;

    await store.getState().configureThread(threadId, { accessProfile: "observe", reasoningLevel: "high" });

    expect(deps.ai.configureThread).toHaveBeenCalledWith(threadId, {
      accessProfile: "observe",
      reasoningLevel: "high",
    });
    expect(store.getState().threads).toContainEqual(
      expect.objectContaining({ id: threadId, accessProfile: "observe", reasoningLevel: "high" }),
    );
  });

  it("deleting the last thread opens a fresh one", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    await vi.waitFor(() => expect(store.getState().activeThreadId).not.toBeNull());
    const only = store.getState().activeThreadId as string;

    await store.getState().deleteThread(only);

    expect(store.getState().threads).toHaveLength(1);
    expect(store.getState().activeThreadId).not.toBe(only);
    expect(store.getState().activeThreadId).not.toBeNull();
  });

  it("rejects an outstanding facade command when the store actor is disposed", async () => {
    const submitToThread = vi.fn(() => new Promise<never>(() => {}));
    const deps = createDeps({ submitToThread: submitToThread as unknown as IAI["submitToThread"] });
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });

    const pending = store.getState().submitMessage("hello");
    await vi.waitFor(() => expect(submitToThread).toHaveBeenCalledOnce());
    store.dispose();

    await expect(pending).rejects.toThrow(/Thread client is unavailable/i);
  });
});
