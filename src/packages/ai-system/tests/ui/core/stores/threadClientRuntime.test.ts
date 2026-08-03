import { describe, expect, it, vi } from "vitest";
import type { ThreadEvent, ThreadEventEnvelope } from "@/ai-system/core/threadEvents";
import { emptyThreadView, threadTimelineMessageContent } from "@/ai-system/core/threadReducer";
import type { ThreadSummary } from "@/ai-system/core/threads";
import type { IAI } from "@/ai-system/host/aiClientBridge";
import type { AIStoreDeps, ClientCommandOutcome } from "@/ai-system/ui/core/stores/threadClientReducer";
import { createThreadClientRuntime } from "@/ai-system/ui/core/stores/threadClientRuntime";

// Runtime + reducer coverage complementing aiStore.test.ts (which drives the same runtime through the Zustand
// bridge). Asserts the actor-level guarantees: it keeps projecting bus deltas while a host call is in flight,
// dedups concurrent snapshot refreshes, and reconciles thread selection on delete.

const envelope = (threadId: string, seq: number, event: ThreadEvent): ThreadEventEnvelope => ({
  version: 1,
  threadId,
  taskId: "task-1",
  segmentId: "segment-1",
  seq,
  event,
});

function harness(overrides: Partial<IAI> = {}, depOverrides: Partial<AIStoreDeps> = {}) {
  const outcomes: ClientCommandOutcome[] = [];
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
      threadId: "s",
      taskId: "t",
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
    ...overrides,
  } as unknown as IAI;
  const runtime = createThreadClientRuntime(
    { getAI: () => ai, log: { error: vi.fn() }, collectBundle: vi.fn(() => ({ engine: "docker" })), ...depOverrides },
    { onChange: () => {}, onOutcome: (outcome) => outcomes.push(outcome) },
  );
  const requestKinds = () => Object.values(runtime.getState().requests).map((request) => request.kind);
  return { runtime, ai, outcomes, requestKinds };
}

describe("threadClientRuntime", () => {
  it("keeps projecting bus deltas while a submit request is still in flight", async () => {
    let releaseSubmit!: () => void;
    const submitToThread = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseSubmit = () =>
            resolve({ accepted: true, threadId: "s", taskId: "t", mode: "started", phase: "model" });
        }),
    );
    const { runtime, requestKinds } = harness({ submitToThread: submitToThread as unknown as IAI["submitToThread"] });
    runtime.send({ type: "NEW_THREAD" });
    await vi.waitFor(() => expect(runtime.getState().activeThreadId).not.toBeNull());
    const threadId = runtime.getState().activeThreadId as string;

    runtime.send({ type: "SUBMIT", commandId: "submit-1", text: "hi" });
    expect(Object.values(runtime.getState().requests)).toContainEqual(expect.objectContaining({ kind: "submit" }));

    runtime.send({ type: "APPLY_EVENT", envelope: envelope(threadId, 1, { type: "assistant-start", id: "a1" }) });
    runtime.send({
      type: "APPLY_EVENT",
      envelope: envelope(threadId, 2, { type: "assistant-delta", id: "a1", text: "Hello" }),
    });
    const view = runtime.getState().views[threadId];
    const assistantIndex = view.timeline.findIndex((item) => item.kind === "message" && item.role === "assistant");
    const assistant = view.timeline[assistantIndex];
    expect(assistant?.kind).toBe("message");
    if (assistant?.kind === "message")
      expect(threadTimelineMessageContent(view, assistant, assistantIndex)).toBe("Hello");

    releaseSubmit();
    await vi.waitFor(() => expect(requestKinds()).not.toContain("submit"));
  });

  it("dedups concurrent snapshot refreshes for the same thread", () => {
    const getThreadSnapshot = vi.fn(() => new Promise(() => {}));
    const { runtime, ai } = harness({ getThreadSnapshot: getThreadSnapshot as unknown as IAI["getThreadSnapshot"] });

    runtime.send({ type: "REFRESH", threadId: "s1" });
    runtime.send({ type: "REFRESH", threadId: "s1" });

    expect(ai.getThreadSnapshot).toHaveBeenCalledTimes(1);
    expect(
      Object.values(runtime.getState().requests).flatMap((r) => (r.kind === "snapshot" ? [r.threadId] : [])),
    ).toEqual(["s1"]);
  });

  it("settles every coalesced snapshot refresh caller", async () => {
    let release!: () => void;
    const getThreadSnapshot = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          release = () => resolve(null);
        }),
    );
    const { runtime, outcomes } = harness({
      getThreadSnapshot: getThreadSnapshot as unknown as IAI["getThreadSnapshot"],
    });

    runtime.send({ type: "REFRESH", threadId: "s1", commandId: "refresh-1" });
    runtime.send({ type: "REFRESH", threadId: "s1", commandId: "refresh-2" });
    release();

    await vi.waitFor(() => expect(outcomes.map((outcome) => outcome.commandId)).toContain("refresh-1"));
    expect(outcomes.map((outcome) => outcome.commandId)).toContain("refresh-2");
    expect(getThreadSnapshot).toHaveBeenCalledOnce();
  });

  it("surfaces recovery-buffer overflow to the user", async () => {
    const getThreadSnapshot = vi.fn(() => new Promise<null>(() => {}));
    const { runtime } = harness({ getThreadSnapshot: getThreadSnapshot as unknown as IAI["getThreadSnapshot"] });
    await vi.waitFor(() => expect(runtime.getState().activeThreadId).not.toBeNull());
    const threadId = runtime.getState().activeThreadId as string;

    for (let seq = 2; seq <= 258; seq += 1) {
      runtime.send({
        type: "APPLY_EVENT",
        envelope: envelope(threadId, seq, { type: "assistant-delta", id: "a1", text: "x" }),
      });
    }

    expect(runtime.getState().recoveryErrors[threadId]).toMatch(/too many events/i);
  });

  it("hydrates once at start and merges threads created while loading", async () => {
    let release!: (threads: ThreadSummary[]) => void;
    const listThreads = vi.fn(
      () =>
        new Promise<ThreadSummary[]>((resolve) => {
          release = resolve;
        }),
    );
    const { runtime } = harness({ listThreads });

    expect(listThreads).toHaveBeenCalledOnce();
    runtime.send({ type: "NEW_THREAD" });
    await vi.waitFor(() => expect(runtime.getState().activeThreadId).not.toBeNull());
    const liveId = runtime.getState().activeThreadId as string;
    release([{ id: "stored-thread", title: "Stored", createdAt: 1, updatedAt: 1, phase: "idle", lastSeq: 0 }]);

    await vi.waitFor(() => expect(runtime.getState().lifecycle).toBe("ready"));
    expect(runtime.getState().threads.map((thread) => thread.id)).toEqual(["stored-thread", liveId]);
    expect(runtime.getState().activeThreadId).toBe(liveId);
  });

  it("restores active selection separately from thread history and persists later selection", async () => {
    const summaries: ThreadSummary[] = [
      { id: "older", title: "Older", createdAt: 1, updatedAt: 1, phase: "idle", lastSeq: 0 },
      { id: "newer", title: "Newer", createdAt: 2, updatedAt: 2, phase: "idle", lastSeq: 0 },
    ];
    const saveSelectedThreadId = vi.fn();
    const { runtime } = harness(
      { listThreads: vi.fn(async () => summaries) },
      { loadSelectedThreadId: () => "older", saveSelectedThreadId },
    );

    await vi.waitFor(() => expect(runtime.getState().lifecycle).toBe("ready"));
    expect(runtime.getState().activeThreadId).toBe("older");
    runtime.send({ type: "SET_ACTIVE", id: "newer" });

    expect(runtime.getState().activeThreadId).toBe("newer");
    expect(saveSelectedThreadId).toHaveBeenLastCalledWith("newer");
  });

  it("selects the most recently updated thread when no prior selection exists", async () => {
    const summaries: ThreadSummary[] = [
      { id: "newer", title: "Newer", createdAt: 2, updatedAt: 20, phase: "idle", lastSeq: 0 },
      { id: "older", title: "Older", createdAt: 1, updatedAt: 10, phase: "idle", lastSeq: 0 },
    ];
    const { runtime } = harness({ listThreads: vi.fn(async () => summaries) }, { loadSelectedThreadId: () => null });

    await vi.waitFor(() => expect(runtime.getState().lifecycle).toBe("ready"));

    expect(runtime.getState().activeThreadId).toBe("newer");
  });

  it("removes a completed Stop request", async () => {
    const { runtime } = harness();
    await vi.waitFor(() => expect(runtime.getState().activeThreadId).not.toBeNull());

    runtime.send({ type: "CANCEL", commandId: "cancel-1" });

    await vi.waitFor(() => expect(Object.keys(runtime.getState().requests)).toHaveLength(0));
  });

  it("removes a failed Stop request and rejects its correlated command", async () => {
    const stopThread = vi.fn(async () => Promise.reject(new Error("stop unavailable")));
    const { runtime, outcomes } = harness({ stopThread });
    await vi.waitFor(() => expect(runtime.getState().activeThreadId).not.toBeNull());

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
    const getThreadSnapshot = vi.fn(async () => null);
    const { runtime } = harness({ getThreadSnapshot });

    runtime.send({
      type: "APPLY_EVENT",
      envelope: envelope("missing", 3, { type: "assistant-delta", id: "a1", text: "tail" }),
    });

    await vi.waitFor(() => expect(runtime.getState().recoveryErrors.missing).toMatch(/unable to recover/i));
    expect(getThreadSnapshot).toHaveBeenCalledTimes(3);
    expect(
      Object.values(runtime.getState().requests).flatMap((r) => (r.kind === "snapshot" ? [r.threadId] : [])),
    ).not.toContain("missing");
  });

  it("settles all coalesced refresh commands when snapshot loading fails", async () => {
    let reject!: (error: Error) => void;
    const getThreadSnapshot = vi.fn(
      () =>
        new Promise<null>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { runtime, outcomes } = harness({
      getThreadSnapshot: getThreadSnapshot as unknown as IAI["getThreadSnapshot"],
    });

    runtime.send({ type: "REFRESH", threadId: "s1", commandId: "refresh-1" });
    runtime.send({ type: "REFRESH", threadId: "s1", commandId: "refresh-2" });
    reject(new Error("snapshot unavailable"));

    await vi.waitFor(() => expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(2));
    expect(outcomes.map((outcome) => outcome.commandId)).toEqual(expect.arrayContaining(["refresh-1", "refresh-2"]));
    expect(runtime.getState().recoveryErrors.s1).toBe("snapshot unavailable");
  });

  it("extracts a readable message from a structured snapshot failure", async () => {
    const getThreadSnapshot = vi.fn(async () => Promise.reject({ error: { message: "snapshot payload rejected" } }));
    const { runtime } = harness({ getThreadSnapshot });

    runtime.send({ type: "REFRESH", threadId: "s1" });

    await vi.waitFor(() => expect(runtime.getState().recoveryErrors.s1).toBe("snapshot payload rejected"));
    expect(runtime.getState().recoveryErrors.s1).not.toContain("[object Object]");
  });

  it("owns and releases the bus subscription with the runtime lifecycle", () => {
    const unsubscribe = vi.fn();
    const subscribeEvents = vi.fn(() => unsubscribe);
    const { runtime } = harness({}, { subscribeEvents });

    expect(subscribeEvents).toHaveBeenCalledOnce();
    runtime.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("reselects the previous thread and clears its view when a thread is deleted", async () => {
    const { runtime, ai } = harness();
    await vi.waitFor(() => expect(runtime.getState().threads).toHaveLength(1));
    const first = runtime.getState().activeThreadId as string;
    runtime.send({ type: "NEW_THREAD" });
    await vi.waitFor(() => expect(runtime.getState().threads).toHaveLength(2));
    const second = runtime.getState().activeThreadId as string;

    runtime.send({ type: "DELETE", commandId: "delete-1", id: second });

    await vi.waitFor(() => expect(runtime.getState().activeThreadId).toBe(first));
    expect(ai.deleteThread).toHaveBeenCalledWith(second);
    expect(runtime.getState().views[second]).toBeUndefined();
    expect(runtime.getState().threads.map((s) => s.id)).toEqual([first]);
  });

  it("recovers losslessly after a sequence gap: buffers later events and drains them onto the snapshot", async () => {
    const getThreadSnapshot = vi.fn(async (id: string) => ({
      threadId: id,
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
    const { runtime } = harness({ getThreadSnapshot: getThreadSnapshot as unknown as IAI["getThreadSnapshot"] });
    await vi.waitFor(() => expect(runtime.getState().activeThreadId).not.toBeNull());
    const s = runtime.getState().activeThreadId as string;

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

  it("ignores a snapshot that completes after its thread was deleted", async () => {
    let releaseSnapshot!: () => void;
    const getThreadSnapshot = vi.fn(
      (threadId: string) =>
        new Promise((resolve) => {
          releaseSnapshot = () => resolve({ ...emptyThreadView(threadId), lastSeq: 5 });
        }),
    );
    const { runtime } = harness({ getThreadSnapshot: getThreadSnapshot as unknown as IAI["getThreadSnapshot"] });
    await vi.waitFor(() => expect(runtime.getState().activeThreadId).not.toBeNull());
    const deleted = runtime.getState().activeThreadId as string;
    runtime.send({ type: "REFRESH", threadId: deleted });

    runtime.send({ type: "DELETE", commandId: "delete-1", id: deleted });
    await vi.waitFor(() => expect(runtime.getState().threads.some((thread) => thread.id === deleted)).toBe(false));
    releaseSnapshot();

    await vi.waitFor(() =>
      expect(
        Object.values(runtime.getState().requests).flatMap((r) => (r.kind === "snapshot" ? [r.threadId] : [])),
      ).not.toContain(deleted),
    );
    expect(runtime.getState().views[deleted]).toBeUndefined();
  });
});
