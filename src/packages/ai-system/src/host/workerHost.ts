import { removeWorker, upsertWorker, type WorkerDefinition, type WorkerStore } from "@/ai-system/core/workers";

// CRUD over the workers library. Deliberately thin: all the policy lives in core/workers (validate, cap, upsert
// semantics) and the boundary schema, so this is only the read-modify-write and the in-memory mirror.
//
// Writes are read-modify-write against the LOADED snapshot rather than a renderer-supplied list, so a stale
// editor cannot silently delete workers it never knew about.
export interface WorkerHostDeps {
  store: WorkerStore;
  logger?: { error: (...args: unknown[]) => void };
}

export interface WorkerHost {
  ready(): Promise<void>;
  list(): WorkerDefinition[];
  save(worker: WorkerDefinition): Promise<WorkerDefinition[]>;
  remove(id: string): Promise<WorkerDefinition[]>;
  // The definitions a run asked for, in roster order, silently dropping ids with no match — a stale editor after
  // a delete is a client race, not a policy failure, and must not fail an otherwise valid run.
  resolveIds(ids: readonly string[]): WorkerDefinition[];
}

export function createWorkerHost(deps: WorkerHostDeps): WorkerHost {
  let workers: WorkerDefinition[] = [];

  const persist = async (next: WorkerDefinition[]): Promise<WorkerDefinition[]> => {
    await deps.store.save(next);
    workers = next;
    return workers;
  };

  return {
    async ready() {
      const snapshot = await deps.store.load();
      workers = snapshot.workers;
      if (snapshot.status === "error") {
        // Surface it and keep the library empty in memory. A save would then overwrite the unreadable file,
        // which is the right trade: the user can see an empty library and rebuild it, but cannot see a
        // half-parsed one and trust it.
        deps.logger?.error("AI: worker library is unreadable", snapshot.path);
      }
    },
    list() {
      return workers;
    },
    async save(worker: WorkerDefinition) {
      return persist(upsertWorker(workers, worker));
    },
    async remove(id: string) {
      return persist(removeWorker(workers, id));
    },
    resolveIds(ids: readonly string[]) {
      return ids
        .map((id) => workers.find((entry) => entry.id === id))
        .filter((entry): entry is WorkerDefinition => Boolean(entry));
    },
  };
}
