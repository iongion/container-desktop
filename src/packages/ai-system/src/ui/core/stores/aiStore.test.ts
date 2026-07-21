import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, ChatEventEnvelope } from "@/ai-system/core/chatEvents";
import { chatTimelineMessageContent, emptyChatSessionView, reduceChatEvent } from "@/ai-system/core/chatReducer";
import type { ConversationSummary } from "@/ai-system/core/conversations";
import type { IAI } from "@/ai-system/host/aiClientBridge";
import { createAIStore } from "./aiStore";

const event = (sessionId: string, seq: number, value: ChatEvent): ChatEventEnvelope => ({
  version: 1,
  sessionId,
  taskId: "task-1",
  segmentId: "segment-1",
  seq,
  event: value,
});

function createDeps(overrides: Partial<IAI> = {}) {
  const conversations = new Map<string, ConversationSummary>();
  const ai = {
    listChats: vi.fn(async () => [...conversations.values()]),
    createChat: vi.fn(async (request) => {
      const now = Date.now();
      const conversation: ConversationSummary = {
        ...request,
        createdAt: now,
        updatedAt: now,
        phase: "idle",
        lastSeq: 0,
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    }),
    submitChat: vi.fn(async () => ({
      accepted: true as const,
      sessionId: "session-1",
      taskId: "task-1",
      mode: "started" as const,
      phase: "model" as const,
    })),
    getChatSnapshot: vi.fn(async () => null),
    resolveChatApproval: vi.fn(async () => ({ accepted: true, phase: "model" as const })),
    stopChat: vi.fn(async () => ({ ok: true as const })),
    deleteChat: vi.fn(async (id) => {
      conversations.delete(id);
      return { ok: true as const };
    }),
    ...overrides,
  } as unknown as IAI;
  const log = { error: vi.fn() };
  return { ai, log, collectBundle: vi.fn(() => ({ engine: "docker" })) };
}

describe("AI store session-event projection", () => {
  it("applies development fixtures through the actor without exposing internal submission state", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    const sessionId = await store.getState().newSession();
    const view = {
      ...emptyChatSessionView(sessionId),
      phase: "model" as const,
      timeline: [{ kind: "message" as const, id: "demo", role: "assistant" as const, content: "fixture" }],
    };

    expect("replaceViewForDev" in store).toBe(true);
    (store as unknown as { replaceViewForDev: (id: string, next: typeof view) => void }).replaceViewForDev(
      sessionId,
      view,
    );

    expect(store.getState().views[sessionId]).toEqual(view);
    expect("pendingSubmissions" in store.getState()).toBe(false);
    store.dispose();
  });

  it("submits one inserted message without optimistic duplication and accepts its event before the invoke reply", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    await store.getState().newSession();
    const sessionId = store.getState().activeSessionId as string;
    (deps.ai.submitChat as any).mockImplementation(async (request: any) => {
      store
        .getState()
        .applyChatEvent(event(sessionId, 1, { type: "user-message", ...request.message, delivery: "applied" }));
      return {
        accepted: true,
        sessionId,
        taskId: "task-1",
        mode: "started",
        phase: "model",
      };
    });

    await store.getState().submitMessage("hello", { providerId: "llamacpp", model: "qwen" });

    const request = (deps.ai.submitChat as any).mock.calls[0][0];
    expect(request).toMatchObject({ sessionId, history: [], providerId: "llamacpp", model: "qwen" });
    expect(store.getState().views[sessionId].timeline).toEqual([
      expect.objectContaining({ kind: "message", role: "user", content: "hello", delivery: "applied" }),
    ]);
  });

  it("projects queued/applied input and addressed assistant deltas without stream bindings", () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    store
      .getState()
      .applyChatEvent(
        event("session-1", 1, { type: "user-message", id: "user-1", content: "wait", delivery: "queued" }),
      );
    store.getState().applyChatEvent(event("session-1", 2, { type: "assistant-start", id: "assistant-1" }));
    store
      .getState()
      .applyChatEvent(event("session-1", 3, { type: "assistant-delta", id: "assistant-1", text: "Part" }));
    store.getState().applyChatEvent(event("session-1", 4, { type: "user-message-applied", id: "user-1" }));
    store
      .getState()
      .applyChatEvent(event("session-1", 5, { type: "assistant-end", id: "assistant-1", status: "interrupted" }));

    expect(store.getState().views["session-1"].timeline).toEqual([
      expect.objectContaining({ id: "user-1", delivery: "applied" }),
      expect.objectContaining({ id: "assistant-1", content: "Part", status: "interrupted" }),
    ]);
  });

  it("recovers an event-sequence gap from the authoritative actor snapshot", async () => {
    let snapshot = emptyChatSessionView("session-1");
    snapshot = reduceChatEvent(
      snapshot,
      event("session-1", 1, { type: "user-message", id: "user-1", content: "hi", delivery: "applied" }),
    ).view;
    snapshot = reduceChatEvent(snapshot, event("session-1", 2, { type: "assistant-start", id: "assistant-1" })).view;
    snapshot = reduceChatEvent(
      snapshot,
      event("session-1", 3, { type: "assistant-delta", id: "assistant-1", text: "Recovered" }),
    ).view;
    const deps = createDeps({ getChatSnapshot: vi.fn(async () => snapshot) });
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });

    store
      .getState()
      .applyChatEvent(event("session-1", 3, { type: "assistant-delta", id: "assistant-1", text: "Recovered" }));
    await vi.waitFor(() => expect(store.getState().views["session-1"]?.lastSeq).toBe(3));
    const recovered = store.getState().views["session-1"];
    const assistantIndex = recovered.timeline.findIndex((item) => item.kind === "message" && item.id === "assistant-1");
    const assistant = recovered.timeline[assistantIndex];
    expect(assistant?.kind).toBe("message");
    if (assistant?.kind === "message") {
      expect(chatTimelineMessageContent(recovered, assistant, assistantIndex)).toBe("Recovered");
    }
  });

  it("awaits approval resolution and stop while reflecting resolving state locally", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolveChatApproval = vi.fn(async () => {
      await pending;
      return { accepted: true, phase: "model" as const };
    });
    const deps = createDeps({ resolveChatApproval });
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    store.getState().applyChatEvent(
      event("session-1", 1, {
        type: "approval-request",
        approvalId: "approval-1",
        toolCallId: "tool-1",
        tool: "runCommand",
        title: "podman stop web",
        args: { program: "podman", args: ["stop", "web"] },
        reason: "Requires approval",
      }),
    );
    store.getState().setActiveSession("session-1");

    const resolving = store.getState().resolveApproval("approval-1", "allow");
    expect(store.getState().views["session-1"].timeline).toContainEqual(
      expect.objectContaining({ kind: "approval", status: "resolving" }),
    );
    release();
    await resolving;
    expect(resolveChatApproval).toHaveBeenCalledWith({
      sessionId: "session-1",
      approvalId: "approval-1",
      decision: "allow",
    });
    await store.getState().cancel();
    expect(deps.ai.stopChat).toHaveBeenCalledWith("session-1");
  });

  it("deletes a session: disposes the host actor, drops persisted prose, and reselects", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    await vi.waitFor(() => expect(store.getState().activeSessionId).not.toBeNull());
    const first = store.getState().activeSessionId as string;
    await store.getState().newSession();
    const second = store.getState().activeSessionId as string;

    await expect(store.getState().deleteSession(second)).resolves.toEqual({ ok: true });

    expect(deps.ai.deleteChat).toHaveBeenCalledWith(second);
    expect(store.getState().sessions.map((s) => s.id)).toEqual([first]);
    expect(store.getState().views[second]).toBeUndefined();
    expect(store.getState().activeSessionId).toBe(first);
    expect(await deps.ai.listChats()).toEqual([expect.objectContaining({ id: first })]);
  });

  it("deleting the last session opens a fresh one", async () => {
    const deps = createDeps();
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });
    await vi.waitFor(() => expect(store.getState().activeSessionId).not.toBeNull());
    const only = store.getState().activeSessionId as string;

    await store.getState().deleteSession(only);

    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().activeSessionId).not.toBe(only);
    expect(store.getState().activeSessionId).not.toBeNull();
  });

  it("rejects an outstanding facade command when the store actor is disposed", async () => {
    const submitChat = vi.fn(() => new Promise<never>(() => {}));
    const deps = createDeps({ submitChat: submitChat as unknown as IAI["submitChat"] });
    const store = createAIStore({ getAI: () => deps.ai, log: deps.log, collectBundle: deps.collectBundle });

    const pending = store.getState().submitMessage("hello");
    await vi.waitFor(() => expect(submitChat).toHaveBeenCalledOnce());
    store.dispose();

    await expect(pending).rejects.toThrow(/chat client is unavailable/i);
  });
});
