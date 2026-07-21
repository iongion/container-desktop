// The workers library — user-authored, reusable agent definitions the goal coordinator assigns to plan tasks.
// OWNED by core: pure data + parse/prepare, no I/O. The file lives beside the permission record in user-data and
// is broker-owned, so a definition (which carries a tool POLICY) is never writable through the generic settings
// path the renderer uses.

import type { z } from "zod";
import { MAX_WORKER_FILE_BYTES, MAX_WORKERS } from "./limits";
import type { WorkerToolPolicyMode } from "./permissions";
import { type workerDefinition, type workerExecutionTarget, workerFileSchema } from "./schemas";

export const WORKER_RECORD_VERSION = 1 as const;

// Single-sourced from the boundary schema — no hand-maintained twin that can drift from what the wire accepts.
export type WorkerDefinition = z.infer<typeof workerDefinition>;
export type WorkerExecutionTarget = z.infer<typeof workerExecutionTarget>;

export interface WorkerFileV1 {
  version: typeof WORKER_RECORD_VERSION;
  workers: WorkerDefinition[];
}

export interface WorkerStoreSnapshot {
  // "missing" is normal (no library yet); "error" means the file exists and is unreadable or invalid, which the
  // host surfaces rather than silently treating as an empty library that a save would then overwrite.
  status: "missing" | "ok" | "error";
  workers: WorkerDefinition[];
  path: string;
}

export interface WorkerStore {
  load(): Promise<WorkerStoreSnapshot>;
  save(workers: WorkerDefinition[]): Promise<void>;
}

// The policy mode as the permission layer understands it. Re-stating the type here would let the two drift.
export function workerPolicyMode(worker: WorkerDefinition): WorkerToolPolicyMode {
  return worker.toolPolicy.mode;
}

// The allowlist as a Set, or undefined when the policy does not narrow the toolset. `undefined` (not an empty
// set) is the "no filtering" signal — an empty set means "this worker holds no tools at all".
export function workerAllowedTools(worker: WorkerDefinition): ReadonlySet<string> | undefined {
  return worker.toolPolicy.mode === "granular" ? new Set(worker.toolPolicy.allowed) : undefined;
}

export function parseWorkerFile(text: string): Pick<WorkerStoreSnapshot, "status" | "workers"> {
  if (text.length > MAX_WORKER_FILE_BYTES) return { status: "error", workers: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "error", workers: [] };
  }
  const result = workerFileSchema.safeParse(parsed);
  if (!result.success) return { status: "error", workers: [] };
  return { status: "ok", workers: result.data.workers };
}

export function prepareWorkerFile(workers: WorkerDefinition[]): WorkerFileV1 {
  const retained = [...workers].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_WORKERS);
  const file = { version: WORKER_RECORD_VERSION, workers: retained } satisfies WorkerFileV1;
  if (!workerFileSchema.safeParse(file).success) {
    throw new Error("AI: invalid or oversized worker definition");
  }
  if (JSON.stringify(file).length > MAX_WORKER_FILE_BYTES) {
    throw new Error("AI: worker library exceeds its size limit");
  }
  return file;
}

// Insert or replace by id, preserving the original createdAt so an edit does not masquerade as a new worker.
export function upsertWorker(workers: WorkerDefinition[], worker: WorkerDefinition): WorkerDefinition[] {
  const existing = workers.find((entry) => entry.id === worker.id);
  const merged: WorkerDefinition = existing ? { ...worker, createdAt: existing.createdAt } : worker;
  if (!existing && workers.length >= MAX_WORKERS) {
    throw new Error("AI: the worker library is full");
  }
  return existing ? workers.map((entry) => (entry.id === worker.id ? merged : entry)) : [...workers, merged];
}

export function removeWorker(workers: WorkerDefinition[], id: string): WorkerDefinition[] {
  return workers.filter((entry) => entry.id !== id);
}
