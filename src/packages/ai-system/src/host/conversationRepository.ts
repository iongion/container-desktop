import {
  type ConversationRecordV1,
  type ConversationStore,
  type ConversationSummary,
  conversationSummary,
} from "@/ai-system/core/conversations";

export interface ConversationRepositoryOptions {
  store: ConversationStore;
  logger?: { error: (...args: unknown[]) => void };
}

export type ConversationRepository = ReturnType<typeof createConversationRepository>;

const DISPOSED_MESSAGE = "AI: conversation repository is disposed";

// A serial, disposable store over the conversations file. The `tail` promise-chain serializes every write
// (concurrency 1); `pending` tracks in-flight rejecters so `dispose` fails them fast (p-queue's `clear`
// would leave those callers unsettled). Reads clone in/out so a retained snapshot never mutates.
export function createConversationRepository(options: ConversationRepositoryOptions) {
  let records: ConversationRecordV1[] = [];
  let tail = Promise.resolve();
  let disposed = false;
  const pending = new Set<(error: Error) => void>();

  const logLoadFailure = (): void => {
    try {
      options.logger?.error("AI: conversation store could not be loaded");
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

  const upsertRecord = (list: ConversationRecordV1[], next: ConversationRecordV1): ConversationRecordV1[] => {
    const index = list.findIndex((record) => record.id === next.id);
    if (index === -1) return [...list, next];
    const updated = [...list];
    updated[index] = next;
    return updated;
  };

  const enqueue = <T>(
    mutation: (records: ConversationRecordV1[]) => { records: ConversationRecordV1[]; result: T },
  ): Promise<T> => {
    let rejectPending!: (error: Error) => void;
    const result = new Promise<T>((resolve, reject) => {
      rejectPending = reject;
      pending.add(reject);
      const run = async () => {
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
      operation.then(resolve, reject);
    });
    return result.finally(() => pending.delete(rejectPending));
  };

  return {
    ready,
    async list(): Promise<ConversationSummary[]> {
      await ready();
      return records
        .map(conversationSummary)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((summary) => structuredClone(summary));
    },
    async get(id: string): Promise<ConversationRecordV1 | undefined> {
      await ready();
      const record = records.find((candidate) => candidate.id === id);
      return record ? structuredClone(record) : undefined;
    },
    create(record: ConversationRecordV1): Promise<ConversationRecordV1> {
      return enqueue((list) => {
        const next = structuredClone(record);
        return { records: upsertRecord(list, next), result: next };
      });
    },
    upsert(record: ConversationRecordV1): Promise<void> {
      return enqueue((list) => ({ records: upsertRecord(list, structuredClone(record)), result: undefined }));
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
