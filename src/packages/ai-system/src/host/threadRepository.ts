import { MAX_RETAINED_THREADS } from "@/ai-system/core/limits";
import { type ApplyThreadCompactionInput, applyThreadCompaction } from "@/ai-system/core/threadCompaction";
import {
  appendThreadCheckpoint,
  type BranchThreadRecordInput,
  branchThreadRecord,
  type ThreadConfigurationPatch,
  type ThreadRecord,
  type ThreadStore,
  type ThreadSummary,
  threadSummary,
} from "@/ai-system/core/threads";

export interface ThreadRepositoryOptions {
  store: ThreadStore;
  logger?: { error: (...args: unknown[]) => void };
}

export type ThreadRepository = ReturnType<typeof createThreadRepository>;

const DISPOSED_MESSAGE = "AI: thread repository is disposed";

function mergeCheckpoints(existing: ThreadRecord, incoming: ThreadRecord): ThreadRecord["checkpoints"] {
  const merged = [...existing.checkpoints];
  const boundaries = new Set(
    merged.map((checkpoint) =>
      JSON.stringify([checkpoint.messageId, checkpoint.timelineLength, checkpoint.modelHistoryLength]),
    ),
  );
  for (const checkpoint of incoming.checkpoints) {
    const boundary = JSON.stringify([checkpoint.messageId, checkpoint.timelineLength, checkpoint.modelHistoryLength]);
    if (boundaries.has(boundary)) continue;
    boundaries.add(boundary);
    merged.push(checkpoint);
  }
  return merged
    .filter(
      (checkpoint) =>
        checkpoint.timelineLength <= incoming.view.timeline.length &&
        checkpoint.modelHistoryLength <= incoming.modelHistory.length,
    )
    .sort((left, right) => left.timelineLength - right.timelineLength);
}

// A serial, disposable store over the threads file. The `tail` promise-chain serializes every write
// (concurrency 1); `pending` tracks in-flight rejecters so `dispose` fails them fast (p-queue's `clear`
// would leave those callers unsettled). Reads clone in/out so a retained snapshot never mutates.
export function createThreadRepository(options: ThreadRepositoryOptions) {
  let records: ThreadRecord[] = [];
  let tail = Promise.resolve();
  let disposed = false;
  const pending = new Set<(error: Error) => void>();

  const logLoadFailure = (): void => {
    try {
      options.logger?.error("AI: thread store could not be loaded");
    } catch {}
  };

  const readyPromise = options.store
    .load()
    .then((snapshot) => {
      records = snapshot.records.map((record) => structuredClone(record));
      if (snapshot.status === "error") logLoadFailure();
    })
    .catch(() => {
      records = [];
      logLoadFailure();
    });
  const ready = (): Promise<void> => readyPromise;

  const upsertRecord = (list: ThreadRecord[], next: ThreadRecord): ThreadRecord[] => {
    const index = list.findIndex((record) => record.id === next.id);
    if (index === -1) return [...list, next];
    const updated = [...list];
    updated[index] = next;
    return updated;
  };

  const retainRecords = (list: ThreadRecord[]): ThreadRecord[] =>
    [...list].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_RETAINED_THREADS);

  const enqueue = <T>(mutation: (records: ThreadRecord[]) => { records: ThreadRecord[]; result: T }): Promise<T> => {
    let rejectPending!: (error: Error) => void;
    const result = new Promise<T>((resolve, reject) => {
      rejectPending = reject;
      pending.add(reject);
      const run = async () => {
        await ready();
        if (disposed) throw new Error(DISPOSED_MESSAGE);
        const next = mutation(records.map((record) => structuredClone(record)));
        const retained = retainRecords(next.records);
        await options.store.save(retained);
        if (disposed) throw new Error(DISPOSED_MESSAGE);
        records = retained;
        return structuredClone(next.result);
      };
      const operation = tail.then(run);
      tail = operation.then(
        () => undefined,
        () => undefined,
      );
      operation.then(resolve, reject);
    });
    return result.finally(() => pending.delete(rejectPending));
  };

  return {
    ready,
    async list(): Promise<ThreadSummary[]> {
      await ready();
      return records
        .map(threadSummary)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((summary) => structuredClone(summary));
    },
    async get(id: string): Promise<ThreadRecord | undefined> {
      await ready();
      const record = records.find((candidate) => candidate.id === id);
      return record ? structuredClone(record) : undefined;
    },
    create(record: ThreadRecord): Promise<ThreadRecord> {
      return enqueue((list) => {
        const next = structuredClone(record);
        return { records: upsertRecord(list, next), result: next };
      });
    },
    upsert(record: ThreadRecord): Promise<void> {
      return enqueue((list) => {
        const existing = list.find((candidate) => candidate.id === record.id);
        const incoming = existing
          ? {
              ...structuredClone(record),
              checkpoints: mergeCheckpoints(existing, record),
              ...(existing.lineage ? { lineage: existing.lineage } : {}),
            }
          : structuredClone(record);
        const next =
          existing?.titleOrigin === "user" && record.titleOrigin !== "user"
            ? {
                ...incoming,
                title: existing.title,
                titleOrigin: "user" as const,
                updatedAt: Math.max(existing.updatedAt, record.updatedAt),
              }
            : incoming;
        return { records: upsertRecord(list, next), result: undefined };
      });
    },
    rename(id: string, title: string, updatedAt: number): Promise<ThreadRecord> {
      return enqueue((list) => {
        const existing = list.find((record) => record.id === id);
        if (!existing) throw new Error("AI: Thread not found");
        const renamed = { ...existing, title, titleOrigin: "user" as const, updatedAt };
        return { records: upsertRecord(list, renamed), result: renamed };
      });
    },
    configure(id: string, patch: ThreadConfigurationPatch, updatedAt: number): Promise<ThreadRecord> {
      return enqueue((list) => {
        const existing = list.find((record) => record.id === id);
        if (!existing) throw new Error("AI: Thread not found");
        const configured = {
          ...existing,
          ...(patch.accessProfile !== undefined ? { accessProfile: patch.accessProfile } : {}),
          ...(patch.reasoningLevel !== undefined ? { reasoningLevel: patch.reasoningLevel } : {}),
          updatedAt,
        };
        return { records: upsertRecord(list, configured), result: configured };
      });
    },
    branch(sourceId: string, input: BranchThreadRecordInput): Promise<ThreadRecord> {
      return enqueue((list) => {
        const source = list.find((record) => record.id === sourceId);
        if (!source) throw new Error("AI: Thread not found");
        if (list.some((record) => record.id === input.id)) throw new Error("AI: Thread already exists");
        const branch = branchThreadRecord(source, input);
        return { records: [...list, branch], result: branch };
      });
    },
    checkpoint(id: string, input: { id: string; now: number }): Promise<ThreadRecord> {
      return enqueue((list) => {
        const existing = list.find((record) => record.id === id);
        if (!existing) throw new Error("AI: Thread not found");
        const checkpointed = appendThreadCheckpoint(existing, input);
        return { records: upsertRecord(list, checkpointed), result: checkpointed };
      });
    },
    compact(id: string, input: ApplyThreadCompactionInput): Promise<ThreadRecord> {
      return enqueue((list) => {
        const existing = list.find((record) => record.id === id);
        if (!existing) throw new Error("AI: Thread not found");
        const compacted = applyThreadCompaction(existing, input);
        return { records: upsertRecord(list, compacted), result: compacted };
      });
    },
    delete(id: string): Promise<boolean> {
      return enqueue((list) => ({
        records: list.filter((record) => record.id !== id),
        result: list.some((record) => record.id === id),
      }));
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const error = new Error(DISPOSED_MESSAGE);
      for (const reject of pending) reject(error);
      pending.clear();
    },
  };
}
