import { describe, expect, it, vi } from "vitest";

import {
  type ConversationRecordV1,
  type ConversationStore,
  createEmptyConversationRecord,
} from "@/ai-system/core/conversations";
import { createConversationRepository } from "./conversationRepository";

function storeWith(records: ConversationRecordV1[] = []): ConversationStore & { save: ReturnType<typeof vi.fn> } {
  return {
    load: vi.fn(async () => ({ status: "ok" as const, records: structuredClone(records), path: "/data/chats.json" })),
    save: vi.fn(async () => {}),
  };
}

const record = (id: string, now: number) => createEmptyConversationRecord({ id, title: id, now });

describe("ConversationRepository", () => {
  it("hydrates once and exposes sorted durable summaries", async () => {
    const store = storeWith([record("older", 1), record("newer", 2)]);
    const repository = createConversationRepository({ store });

    await repository.ready();

    expect(await repository.list()).toEqual([
      expect.objectContaining({ id: "newer", phase: "idle" }),
      expect.objectContaining({ id: "older", phase: "idle" }),
    ]);
    expect(store.load).toHaveBeenCalledOnce();
    await repository.dispose();
  });

  it("does not expose create until the durable write succeeds", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = storeWith();
    store.save.mockImplementationOnce(async () => blocked);
    const repository = createConversationRepository({ store });
    await repository.ready();

    let settled = false;
    const created = repository.create(record("chat-1", 1)).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(await repository.list()).toEqual([]);
    release();
    await expect(created).resolves.toMatchObject({ id: "chat-1" });
    expect(await repository.list()).toEqual([expect.objectContaining({ id: "chat-1" })]);
    await repository.dispose();
  });

  it("rolls back a failed write and continues with the next queued mutation", async () => {
    const store = storeWith();
    store.save.mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
    const repository = createConversationRepository({ store });
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
    const repository = createConversationRepository({ store });
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

  it("settles outstanding commands when disposed", async () => {
    let release!: () => void;
    const store = storeWith();
    store.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const repository = createConversationRepository({ store });
    await repository.ready();
    const pending = repository.create(record("chat-1", 1));
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledOnce());

    await repository.dispose();

    await expect(pending).rejects.toThrow(/disposed/i);
    release();
  });
});
