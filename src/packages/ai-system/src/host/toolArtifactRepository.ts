import { retainToolArtifacts, type ToolArtifactRecord, type ToolArtifactStore } from "@/ai-system/core/toolArtifacts";

export interface ToolArtifactRepositoryOptions {
  store: ToolArtifactStore;
  logger?: { error: (...args: unknown[]) => void };
}

export type ToolArtifactRepository = ReturnType<typeof createToolArtifactRepository>;

const DISPOSED_MESSAGE = "AI: tool artifact repository is disposed";

export function createToolArtifactRepository(options: ToolArtifactRepositoryOptions) {
  let records: ToolArtifactRecord[] = [];
  let tail = Promise.resolve();
  let disposed = false;
  const readyPromise = options.store
    .load()
    .then((snapshot) => {
      records = snapshot.records.map((record) => structuredClone(record));
      if (snapshot.status === "error") options.logger?.error("AI: tool artifact store could not be loaded");
    })
    .catch(() => {
      records = [];
      options.logger?.error("AI: tool artifact store could not be loaded");
    });

  const ready = (): Promise<void> => readyPromise;
  const enqueue = <T>(mutation: (current: ToolArtifactRecord[]) => { records: ToolArtifactRecord[]; result: T }) => {
    const run = async (): Promise<T> => {
      await ready();
      if (disposed) throw new Error(DISPOSED_MESSAGE);
      const next = mutation(records.map((record) => structuredClone(record)));
      await options.store.save(next.records);
      if (disposed) throw new Error(DISPOSED_MESSAGE);
      records = next.records;
      return structuredClone(next.result);
    };
    const operation = tail.then(run);
    tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  return {
    ready,
    async get(threadId: string, id: string): Promise<ToolArtifactRecord | undefined> {
      await ready();
      const record = records.find((candidate) => candidate.id === id && candidate.threadId === threadId);
      return record ? structuredClone(record) : undefined;
    },
    put(record: ToolArtifactRecord): Promise<ToolArtifactRecord> {
      return enqueue((current) => {
        if (current.some(({ id }) => id === record.id)) throw new Error("AI: tool artifact already exists");
        const next = structuredClone(record);
        return { records: retainToolArtifacts([...current, next]), result: next };
      });
    },
    deleteForThread(threadId: string): Promise<number> {
      return enqueue((current) => {
        const retained = current.filter((record) => record.threadId !== threadId);
        return { records: retained, result: current.length - retained.length };
      });
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      await tail;
      disposed = true;
    },
  };
}
