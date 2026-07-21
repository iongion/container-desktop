import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, ChatEventEnvelope } from "@/ai-system/core/chatEvents";
import { chatTimelineMessageContent, emptyChatSessionView } from "@/ai-system/core/chatReducer";
import type { ConversationSummary } from "@/ai-system/core/conversations";
import type { IAI } from "@/ai-system/host/aiClientBridge";
import type { AIStoreDeps, ClientCommandOutcome } from "./chatClientReducer";
import { createChatClientRuntime } from "./chatClientRuntime";

// Runtime + reducer coverage complementing aiStore.test.ts (which drives the same runtime through the Zustand
// bridge). Asserts the actor-level guarantees: it keeps projecting bus deltas while a host call is in flight,
// dedups concurrent snapshot refreshes, and reconciles session selection on delete.

const envelope = (sessionId: string, seq: number, event: ChatEvent): ChatEventEnvelope => ({
  version: 1,
  sessionId,
  taskId: "task-1",
  segmentId: "segment-1",
  seq,
  event,
});

function harness(overrides: Partial<IAI> = {}, depOverrides: Partial<AIStoreDeps> = {}) {
  const outcomes: ClientCommandOutcome[] = [];
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
      sessionId: "s",
      taskId: "t",
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
  const runtime = createChatClientRuntime(
    { getAI: () => ai, log: { error: vi.fn() }, collectBundle: vi.fn(() => ({ engine: "docker" })), ...depOverrides },
    { onChange: () => {}, onOutcome: (outcome) => outcomes.push(outcome) },
  );
  const requestKinds = () => Object.values(runtime.getState().requests).map((request) => request.kind);
  return { runtime, ai, outcomes, requestKinds };
}

describe("chatClientRuntime", () => {
  it("keeps projecting bus deltas while a submit request is still in flight", async () => {
    let releaseSubmit!: () => void;
    const submitChat = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseSubmit = () =>
            resolve({ accepted: true, sessionId: "s", taskId: "t", mode: "started", phase: "model" });
        }),
    );
    const { runtime, requestKinds } = harness({ submitChat: submitChat as unknown as IAI["submitChat"] });
    runtime.send({ type: "NEW_SESSION" });
    await vi.waitFor(() => expect(runtime.getState().activeSessionId).not.toBeNull());
    const sessionId = runtime.getState().activeSessionId as string;

    runtime.send({ type: "SUBMIT", commandId: "submit-1", text: "hi" });
    expect(Object.values(runtime.getState().requests)).toContainEqual(expect.objectContaining({ kind: "submit" }));

    runtime.send({ type: "APPLY_EVENT", envelope: envelope(sessionId, 1, { type: "assistant-start", id: "a1" }) });
    runtime.send({
      type: "APPLY_EVENT",
      envelope: envelope(sessionId, 2, { type: "assistant-delta", id: "a1", text: "Hello" }),
    });
    const view = runtime.getState().views[sessionId];
    const assistantIndex = view.timeline.findIndex((item) => item.kind === "message" && item.role === "assistant");
    const assistant = view.timeline[assistantIndex];
    expect(assistant?.kind).toBe("message");
    if (assistant?.kind === "message")
      expect(chatTimelineMessageContent(view, assistant, assistantIndex)).toBe("Hello");

    releaseSubmit();
    await vi.waitFor(() => expect(requestKinds()).not.toContain("submit"));
  });

  it("dedups concurrent snapshot refreshes for the same session", () => {
    const getChatSnapshot = vi.fn(() => new Promise(() => {}));
    const { runtime, ai } = harness({ getChatSnapshot: getChatSnapshot as unknown as IAI["getChatSnapshot"] });

    runtime.send({ type: "REFRESH", sessionId: "s1" });
    runtime.send({ type: "REFRESH", sessionId: "s1" });

    expect(ai.getChatSnapshot).toHaveBeenCalledTimes(1);
    expect(
      Object.values(runtime.getState().requests).flatMap((r) => (r.kind === "snapshot" ? [r.sessionId] : [])),
    ).toEqual(["s1"]);
  });

  it("settles every coalesced snapshot refresh caller", async () => {
    let release!: () => void;
    const getChatSnapshot = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          release = () => resolve(null);
        }),
    );
    const { runtime, outcomes } = harness({ getChatSnapshot: getChatSnapshot as unknown as IAI["getChatSnapshot"] });

    runtime.send({ type: "REFRESH", sessionId: "s1", commandId: "refresh-1" });
    runtime.send({ type: "REFRESH", sessionId: "s1", commandId: "refresh-2" });
    release();

    await vi.waitFor(() => expect(outcomes.map((outcome) => outcome.commandId)).toContain("refresh-1"));
    expect(outcomes.map((outcome) => outcome.commandId)).toContain("refresh-2");
    expect(getChatSnapshot).toHaveBeenCalledOnce();
  });

  it("surfaces recovery-buffer overflow to the user", async () => {
    const getChatSnapshot = vi.fn(() => new Promise<null>(() => {}));
    const { runtime } = harness({ getChatSnapshot: getChatSnapshot as unknown as IAI["getChatSnapshot"] });
    await vi.waitFor(() => expect(runtime.getState().activeSessionId).not.toBeNull());
    const sessionId = runtime.getState().activeSessionId as string;

    for (let seq = 2; seq <= 258; seq += 1) {
      runtime.send({
        type: "APPLY_EVENT",
        envelope: envelope(sessionId, seq, { type: "assistant-delta", id: "a1", text: "x" }),
      });
    }

    expect(runtime.getState().recoveryErrors[sessionId]).toMatch(/too many events/i);
  });

  it("hydrates once at start and merges sessions created while loading", async () => {
    let release!: (sessions: ConversationSummary[]) => void;
    const listChats = vi.fn(
      () =>
        new Promise<ConversationSummary[]>((resolve) => {
          release = resolve;
        }),
    );
    const { runtime } = harness({ listChats });

    expect(listChats).toHaveBeenCalledOnce();
    runtime.send({ type: "NEW_SESSION" });
    await vi.waitFor(() => expect(runtime.getState().activeSessionId).not.toBeNull());
    const liveId = runtime.getState().activeSessionId as string;
    release([{ id: "stored-session", title: "Stored", createdAt: 1, updatedAt: 1, phase: "idle", lastSeq: 0 }]);

    await vi.waitFor(() => expect(runtime.getState().lifecycle).toBe("ready"));
    expect(runtime.getState().sessions.map((session) => session.id)).toEqual(["stored-session", liveId]);
    expect(runtime.getState().activeSessionId).toBe(liveId);
  });

  it("restores active selection separately from conversation history and persists later selection", async () => {
    const summaries: ConversationSummary[] = [
      { id: "older", title: "Older", createdAt: 1, updatedAt: 1, phase: "idle", lastSeq: 0 },
      { id: "newer", title: "Newer", createdAt: 2, updatedAt: 2, phase: "idle", lastSeq: 0 },
    ];
    const saveSelectedSessionId = vi.fn();
    const { runtime } = harness(
      { listChats: vi.fn(async () => summaries) },
      { loadSelectedSessionId: () => "older", saveSelectedSessionId },
    );

    await vi.waitFor(() => expect(runtime.getState().lifecycle).toBe("ready"));
    expect(runtime.getState().activeSessionId).toBe("older");
    runtime.send({ type: "SET_ACTIVE", id: "newer" });

    expect(runtime.getState().activeSessionId).toBe("newer");
    expect(saveSelectedSessionId).toHaveBeenLastCalledWith("newer");
  });

  it("removes a completed Stop request", async () => {
    const { runtime } = harness();
    await vi.waitFor(() => expect(runtime.getState().activeSessionId).not.toBeNull());

    runtime.send({ type: "CANCEL", commandId: "cancel-1" });

    await vi.waitFor(() => expect(Object.keys(runtime.getState().requests)).toHaveLength(0));
  });

  it("removes a failed Stop request and rejects its correlated command", async () => {
    const stopChat = vi.fn(async () => Promise.reject(new Error("stop unavailable")));
    const { runtime, outcomes } = harness({ stopChat });
    await vi.waitFor(() => expect(runtime.getState().activeSessionId).not.toBeNull());

    runtime.send({ type: "CANCEL", commandId: "cancel-1" });

    await vi.waitFor(() =>
      expect(outcomes).toContainEqual({
        commandId: "cancel-1",
        status: "rejected",
        message: "stop unavailable",
        type: "CLIENT.OUTCOME",
      }),
    );
    expect(Object.keys(runtime.getState().requests)).toHaveLength(0);
  });

  it("bounds null-snapshot recovery retries and surfaces a visible recovery error", async () => {
    const getChatSnapshot = vi.fn(async () => null);
    const { runtime } = harness({ getChatSnapshot });

    runtime.send({
      type: "APPLY_EVENT",
      envelope: envelope("missing", 3, { type: "assistant-delta", id: "a1", text: "tail" }),
    });

    await vi.waitFor(() => expect(runtime.getState().recoveryErrors.missing).toMatch(/unable to recover/i));
    expect(getChatSnapshot).toHaveBeenCalledTimes(3);
    expect(
      Object.values(runtime.getState().requests).flatMap((r) => (r.kind === "snapshot" ? [r.sessionId] : [])),
    ).not.toContain("missing");
  });

  it("settles all coalesced refresh commands when snapshot loading fails", async () => {
    let reject!: (error: Error) => void;
    const getChatSnapshot = vi.fn(
      () =>
        new Promise<null>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { runtime, outcomes } = harness({ getChatSnapshot: getChatSnapshot as unknown as IAI["getChatSnapshot"] });

    runtime.send({ type: "REFRESH", sessionId: "s1", commandId: "refresh-1" });
    runtime.send({ type: "REFRESH", sessionId: "s1", commandId: "refresh-2" });
    reject(new Error("snapshot unavailable"));

    await vi.waitFor(() => expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(2));
    expect(outcomes.map((outcome) => outcome.commandId)).toEqual(expect.arrayContaining(["refresh-1", "refresh-2"]));
    expect(runtime.getState().recoveryErrors.s1).toBe("snapshot unavailable");
  });

  it("owns and releases the bus subscription with the runtime lifecycle", () => {
    const unsubscribe = vi.fn();
    const subscribeEvents = vi.fn(() => unsubscribe);
    const { runtime } = harness({}, { subscribeEvents });

    expect(subscribeEvents).toHaveBeenCalledOnce();
    runtime.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("reselects the previous session and clears its view when a session is deleted", async () => {
    const { runtime, ai } = harness();
    await vi.waitFor(() => expect(runtime.getState().sessions).toHaveLength(1));
    const first = runtime.getState().activeSessionId as string;
    runtime.send({ type: "NEW_SESSION" });
    await vi.waitFor(() => expect(runtime.getState().sessions).toHaveLength(2));
    const second = runtime.getState().activeSessionId as string;

    runtime.send({ type: "DELETE", commandId: "delete-1", id: second });

    await vi.waitFor(() => expect(runtime.getState().activeSessionId).toBe(first));
    expect(ai.deleteChat).toHaveBeenCalledWith(second);
    expect(runtime.getState().views[second]).toBeUndefined();
    expect(runtime.getState().sessions.map((s) => s.id)).toEqual([first]);
  });

  it("recovers losslessly after a sequence gap: buffers later events and drains them onto the snapshot", async () => {
    const getChatSnapshot = vi.fn(async (id: string) => ({
      sessionId: id,
      phase: "model" as const,
      lastSeq: 3,
      timeline: [
        {
          kind: "message" as const,
          id: "a1",
          role: "assistant" as const,
          content: "one ",
          delivery: "applied" as const,
          status: "streaming" as const,
        },
      ],
    }));
    const { runtime } = harness({ getChatSnapshot: getChatSnapshot as unknown as IAI["getChatSnapshot"] });
    await vi.waitFor(() => expect(runtime.getState().activeSessionId).not.toBeNull());
    const s = runtime.getState().activeSessionId as string;

    runtime.send({ type: "APPLY_EVENT", envelope: envelope(s, 1, { type: "assistant-start", id: "a1" }) });
    runtime.send({
      type: "APPLY_EVENT",
      envelope: envelope(s, 2, { type: "assistant-delta", id: "a1", text: "one " }),
    });
    runtime.send({
      type: "APPLY_EVENT",
      envelope: envelope(s, 4, { type: "assistant-delta", id: "a1", text: "four " }),
    });
    runtime.send({
      type: "APPLY_EVENT",
      envelope: envelope(s, 5, { type: "assistant-end", id: "a1", status: "complete" }),
    });

    await vi.waitFor(() => expect(runtime.getState().views[s]?.lastSeq).toBe(5));
    expect(runtime.getState().views[s].timeline).toContainEqual(
      expect.objectContaining({ role: "assistant", status: "complete" }),
    );
  });

  it("ignores a snapshot that completes after its session was deleted", async () => {
    let releaseSnapshot!: () => void;
    const getChatSnapshot = vi.fn(
      (sessionId: string) =>
        new Promise((resolve) => {
          releaseSnapshot = () => resolve({ ...emptyChatSessionView(sessionId), lastSeq: 5 });
        }),
    );
    const { runtime } = harness({ getChatSnapshot: getChatSnapshot as unknown as IAI["getChatSnapshot"] });
    await vi.waitFor(() => expect(runtime.getState().activeSessionId).not.toBeNull());
    const deleted = runtime.getState().activeSessionId as string;
    runtime.send({ type: "REFRESH", sessionId: deleted });

    runtime.send({ type: "DELETE", commandId: "delete-1", id: deleted });
    await vi.waitFor(() => expect(runtime.getState().sessions.some((session) => session.id === deleted)).toBe(false));
    releaseSnapshot();

    await vi.waitFor(() =>
      expect(
        Object.values(runtime.getState().requests).flatMap((r) => (r.kind === "snapshot" ? [r.sessionId] : [])),
      ).not.toContain(deleted),
    );
    expect(runtime.getState().views[deleted]).toBeUndefined();
  });
});
