import { describe, expect, it, vi } from "vitest";
import { MAX_RETAINED_THREADS } from "@/ai-system/core/limits";
import { planThreadCompaction } from "@/ai-system/core/threadCompaction";
import {
  appendThreadCheckpoint,
  createEmptyThreadRecord,
  type ThreadRecord,
  type ThreadStore,
} from "@/ai-system/core/threads";
import { createThreadRepository } from "@/ai-system/host/threadRepository";

function storeWith(records: ThreadRecord[] = []): ThreadStore & { save: ReturnType<typeof vi.fn> } {
  return {
    load: vi.fn(async () => ({ status: "ok" as const, records: structuredClone(records), path: "/data/chats.json" })),
    save: vi.fn(async () => {}),
  };
}

const record = (id: string, now: number) => createEmptyThreadRecord({ id, title: id, now });

describe("ThreadRepository", () => {
  it("applies a compaction atomically against its preview revision", async () => {
    let source = record("thread-1", 1);
    source.view.timeline = [
      {
        kind: "message",
        id: "message-1",
        role: "assistant",
        content: "First answer",
        delivery: "applied",
        status: "complete",
      },
    ];
    source.modelHistory = [{ role: "assistant", content: [{ type: "text", text: "First answer" }] }];
    source = appendThreadCheckpoint(source, { id: "checkpoint-1", now: 2 });
    source.view.timeline.push({
      kind: "message",
      id: "message-2",
      role: "user",
      content: "Recent question",
      delivery: "applied",
      status: "complete",
    });
    source.modelHistory.push({ role: "user", content: [{ type: "text", text: "Recent question" }] });
    source.view.lastSeq = 2;
    const plan = planThreadCompaction(source, { retainRecentMessages: 1, minimumSourceMessages: 1 });
    if (!plan) throw new Error("compaction plan missing");
    const repository = createThreadRepository({ store: storeWith([source]) });
    await repository.ready();

    await expect(
      repository.compact("thread-1", {
        id: "compaction-1",
        createdAt: 3,
        plan,
        summary: "First answer retained.",
        inputTokens: 20,
        outputTokens: 5,
        fingerprint: "a".repeat(64),
      }),
    ).resolves.toMatchObject({ activeCompactionId: "compaction-1" });
    await expect(
      repository.compact("thread-1", {
        id: "compaction-stale",
        createdAt: 4,
        plan,
        summary: "Stale summary",
        inputTokens: 20,
        outputTokens: 5,
        fingerprint: "b".repeat(64),
      }),
    ).rejects.toThrow(/changed/i);
  });

  it("hydrates once and exposes sorted durable summaries", async () => {
    const store = storeWith([record("older", 1), record("newer", 2)]);
    const repository = createThreadRepository({ store });

    await repository.ready();

    expect(await repository.list()).toEqual([
      expect.objectContaining({ id: "newer", phase: "idle" }),
      expect.objectContaining({ id: "older", phase: "idle" }),
    ]);
    expect(store.load).toHaveBeenCalledOnce();
    await repository.dispose();
  });

  it("keeps its live snapshot within the durable Thread retention bound", async () => {
    const store = storeWith();
    const repository = createThreadRepository({ store });
    await repository.ready();

    for (let index = 0; index <= MAX_RETAINED_THREADS; index += 1) {
      await repository.create(record(`thread-${index}`, index));
    }

    const retained = await repository.list();
    expect(retained).toHaveLength(MAX_RETAINED_THREADS);
    expect(retained[0].id).toBe(`thread-${MAX_RETAINED_THREADS}`);
    expect(retained.some(({ id }) => id === "thread-0")).toBe(false);
    expect(store.save).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: "thread-1" })]));
    await repository.dispose();
  });

  it("does not expose create until the durable write succeeds", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = storeWith();
    store.save.mockImplementationOnce(async () => blocked);
    const repository = createThreadRepository({ store });
    await repository.ready();

    let settled = false;
    const created = repository.create(record("thread-1", 1)).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(await repository.list()).toEqual([]);
    release();
    await expect(created).resolves.toMatchObject({ id: "thread-1" });
    expect(await repository.list()).toEqual([expect.objectContaining({ id: "thread-1" })]);
    await repository.dispose();
  });

  it("rolls back a failed write and continues with the next queued mutation", async () => {
    const store = storeWith();
    store.save.mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
    const repository = createThreadRepository({ store });
    await repository.ready();

    const failed = repository.create(record("not-committed", 1));
    const succeeded = repository.create(record("committed", 2));

    await expect(failed).rejects.toThrow("disk full");
    await expect(succeeded).resolves.toMatchObject({ id: "committed" });
    expect((await repository.list()).map((entry) => entry.id)).toEqual(["committed"]);
    expect(store.save).toHaveBeenCalledTimes(2);
    await repository.dispose();
  });

  it("serializes upserts and deletes without losing records", async () => {
    const store = storeWith([record("a", 1)]);
    const repository = createThreadRepository({ store });
    await repository.ready();
    const updatedA = record("a", 3);
    updatedA.title = "updated";

    await Promise.all([repository.upsert(updatedA), repository.create(record("b", 2))]);
    expect((await repository.list()).map((entry) => [entry.id, entry.title])).toEqual([
      ["a", "updated"],
      ["b", "b"],
    ]);
    await expect(repository.delete("a")).resolves.toBe(true);
    await expect(repository.delete("missing")).resolves.toBe(false);
    expect((await repository.list()).map((entry) => entry.id)).toEqual(["b"]);
    await repository.dispose();
  });

  it("renames a thread durably and records that the title was chosen by the user", async () => {
    const store = storeWith([record("thread-1", 1)]);
    const repository = createThreadRepository({ store });
    await repository.ready();

    await expect(repository.rename("thread-1", "Operator notes", 3)).resolves.toMatchObject({
      id: "thread-1",
      title: "Operator notes",
      titleOrigin: "user",
      updatedAt: 3,
    });
    expect(store.save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "thread-1", title: "Operator notes", titleOrigin: "user", updatedAt: 3 }),
    ]);
    await expect(repository.rename("missing", "Nope", 4)).rejects.toThrow(/not found/i);
    await repository.dispose();
  });

  it("configures Thread access and reasoning durably without rewriting its identity", async () => {
    const source = record("thread-1", 1);
    source.title = "Container cleanup";
    const store = storeWith([source]);
    const repository = createThreadRepository({ store });
    await repository.ready();

    await expect(
      repository.configure("thread-1", { accessProfile: "observe", reasoningLevel: undefined }, 2),
    ).resolves.toMatchObject({
      accessProfile: "observe",
      reasoningLevel: "default",
    });
    await expect(repository.configure("thread-1", { reasoningLevel: "high" }, 3)).resolves.toMatchObject({
      id: "thread-1",
      title: "Container cleanup",
      accessProfile: "observe",
      reasoningLevel: "high",
      updatedAt: 3,
    });
    expect(store.save).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: "thread-1",
        title: "Container cleanup",
        accessProfile: "observe",
        reasoningLevel: "high",
      }),
    ]);
    await expect(repository.configure("missing", { accessProfile: "workspace" }, 4)).rejects.toThrow(/not found/i);
    await repository.dispose();
  });

  it("does not let a stale background snapshot overwrite a user title", async () => {
    const store = storeWith([record("thread-1", 1)]);
    const repository = createThreadRepository({ store });
    await repository.ready();
    await repository.rename("thread-1", "Operator notes", 3);
    const staleSnapshot = record("thread-1", 2);
    staleSnapshot.title = "Generated from first prompt";
    staleSnapshot.titleOrigin = "message";

    await repository.upsert(staleSnapshot);

    expect(await repository.get("thread-1")).toMatchObject({
      title: "Operator notes",
      titleOrigin: "user",
      updatedAt: 3,
    });
    await repository.dispose();
  });

  it("branches from the source state serialized immediately before it", async () => {
    const source = record("source", 1);
    source.view.timeline = [
      {
        kind: "message",
        id: "message-1",
        role: "user",
        content: "First boundary",
        delivery: "applied",
        status: "complete",
      },
    ];
    source.modelHistory = [{ role: "user", content: "First boundary" }];
    const first = appendThreadCheckpoint(source, { id: "checkpoint-1", now: 2 });
    const repository = createThreadRepository({ store: storeWith([first]) });
    await repository.ready();

    const updated = structuredClone(first);
    updated.view.timeline.push({
      kind: "message",
      id: "message-2",
      role: "assistant",
      content: "Second boundary",
      delivery: "applied",
      status: "complete",
    });
    updated.modelHistory.push({ role: "assistant", content: "Second boundary" });
    const second = appendThreadCheckpoint(updated, { id: "checkpoint-2", now: 3 });
    const branchInput = {
      id: "branch",
      checkpointId: "branch-checkpoint",
      parentCheckpointId: "checkpoint-2",
      title: "Branch",
      now: 4,
      nextId: (() => {
        const ids = ["branch-message-1", "branch-message-2"];
        return () => ids.shift() ?? "unexpected";
      })(),
    };

    const [, branch] = await Promise.all([repository.upsert(second), repository.branch("source", branchInput)]);

    expect(branch.lineage).toEqual({ parentThreadId: "source", parentCheckpointId: "checkpoint-2" });
    expect(branch.view.timeline).toHaveLength(2);
    expect(await repository.get("source")).toEqual(second);
    await expect(repository.branch("source", branchInput)).rejects.toThrow(/already exists/i);
    await repository.dispose();
  });

  it("appends checkpoints atomically and preserves them across stale background upserts", async () => {
    const source = record("source", 1);
    source.view.timeline = [
      {
        kind: "message",
        id: "message-1",
        role: "assistant",
        content: "Settled",
        delivery: "applied",
        status: "complete",
      },
    ];
    source.modelHistory = [{ role: "assistant", content: "Settled" }];
    const repository = createThreadRepository({ store: storeWith([source]) });
    await repository.ready();

    const checkpointed = await repository.checkpoint("source", { id: "checkpoint-1", now: 2 });
    const stale = structuredClone(source);
    stale.updatedAt = 3;
    await repository.upsert(stale);

    expect(checkpointed.checkpoints).toHaveLength(1);
    expect((await repository.get("source"))?.checkpoints).toEqual(checkpointed.checkpoints);
    await repository.dispose();
  });

  it("settles outstanding commands when disposed", async () => {
    let release!: () => void;
    const store = storeWith();
    store.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const repository = createThreadRepository({ store });
    await repository.ready();
    const pending = repository.create(record("thread-1", 1));
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledOnce());

    await repository.dispose();

    await expect(pending).rejects.toThrow(/disposed/i);
    release();
  });
});
