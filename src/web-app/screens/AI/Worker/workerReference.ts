import type { WorkerDefinition } from "@/ai-system/core/workers";

export type WorkerReferenceResolution =
  | { kind: "resolved"; worker: WorkerDefinition }
  | { kind: "ambiguous" }
  | { kind: "not-found" };

export function resolveWorkerReference(
  workers: readonly WorkerDefinition[],
  reference: string,
): WorkerReferenceResolution {
  const normalized = reference.trim().toLocaleLowerCase();
  const byId = workers.find((worker) => worker.id.toLocaleLowerCase() === normalized);
  if (byId) return { kind: "resolved", worker: byId };

  const byName = workers.filter((worker) => worker.name.toLocaleLowerCase() === normalized);
  if (byName.length === 1) return { kind: "resolved", worker: byName[0] };
  return { kind: byName.length > 1 ? "ambiguous" : "not-found" };
}
