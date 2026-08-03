import { describe, expect, it, vi } from "vitest";

import {
  createToolArtifactRecord,
  type ToolArtifactRecord,
  type ToolArtifactStore,
} from "@/ai-system/core/toolArtifacts";
import { createToolArtifactRepository } from "@/ai-system/host/toolArtifactRepository";

const fingerprint = "a".repeat(64);

function artifact(id: string, threadId = "thread-1", createdAt = 1): ToolArtifactRecord {
  return createToolArtifactRecord({ id, threadId, createdAt, content: JSON.stringify({ id }), fingerprint });
}

function storeWith(records: ToolArtifactRecord[] = []): ToolArtifactStore & {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn(async () => ({ status: "ok" as const, records: structuredClone(records), path: "/private/artifacts" })),
    save: vi.fn(async () => {}),
  };
}

describe("ToolArtifactRepository", () => {
  it("does not expose a write until durable storage succeeds", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = storeWith();
    store.save.mockImplementationOnce(async () => blocked);
    const repository = createToolArtifactRepository({ store });
    await repository.ready();

    const pending = repository.put(artifact("artifact-1"));
    await Promise.resolve();

    await expect(repository.get("thread-1", "artifact-1")).resolves.toBeUndefined();
    release();
    await expect(pending).resolves.toMatchObject({ id: "artifact-1" });
    await expect(repository.get("thread-1", "artifact-1")).resolves.toMatchObject({ id: "artifact-1" });
  });

  it("rolls back failed writes and serializes later mutations", async () => {
    const store = storeWith();
    store.save.mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    const repository = createToolArtifactRepository({ store });
    await repository.ready();

    const failed = repository.put(artifact("failed", "thread-1", 1));
    const saved = repository.put(artifact("saved", "thread-1", 2));

    await expect(failed).rejects.toThrow("disk full");
    await expect(saved).resolves.toMatchObject({ id: "saved" });
    await expect(repository.get("thread-1", "failed")).resolves.toBeUndefined();
    await expect(repository.get("thread-1", "saved")).resolves.toMatchObject({ id: "saved" });
  });

  it("confines reads to the owning Thread and removes its artifacts together", async () => {
    const store = storeWith([artifact("one", "thread-1"), artifact("two", "thread-2")]);
    const repository = createToolArtifactRepository({ store });
    await repository.ready();

    await expect(repository.get("thread-2", "one")).resolves.toBeUndefined();
    await expect(repository.deleteForThread("thread-1")).resolves.toBe(1);
    await expect(repository.get("thread-1", "one")).resolves.toBeUndefined();
    await expect(repository.get("thread-2", "two")).resolves.toMatchObject({ id: "two" });
    expect(store.save).toHaveBeenLastCalledWith([expect.objectContaining({ id: "two" })]);
  });

  it("recovers empty and reports an unreadable store without leaking its path", async () => {
    const logger = { error: vi.fn() };
    const store = storeWith();
    store.load.mockResolvedValueOnce({ status: "error", records: [], path: "/private/do-not-log" });
    const repository = createToolArtifactRepository({ store, logger });

    await repository.ready();

    expect(logger.error).toHaveBeenCalledWith("AI: tool artifact store could not be loaded");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("/private/do-not-log");
  });
});
