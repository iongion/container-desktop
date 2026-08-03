import { describe, expect, it } from "vitest";
import type { WorkerDefinition } from "@/ai-system/core/workers";
import { resolveWorkerReference } from "@/web-app/screens/AI/Worker/workerReference";

const worker = (id: string, name: string) => ({ id, name }) as WorkerDefinition;

describe("resolveWorkerReference", () => {
  const workers = [worker("worker-1", "Inspector"), worker("worker-2", "Inspector"), worker("worker-3", "Editor")];

  it("prefers an exact ID, then a unique case-insensitive name", () => {
    expect(resolveWorkerReference(workers, "worker-2")).toMatchObject({
      kind: "resolved",
      worker: { id: "worker-2" },
    });
    expect(resolveWorkerReference(workers, "EDITOR")).toMatchObject({
      kind: "resolved",
      worker: { id: "worker-3" },
    });
  });

  it("never guesses an ambiguous or partial Worker", () => {
    expect(resolveWorkerReference(workers, "Inspector")).toEqual({ kind: "ambiguous" });
    expect(resolveWorkerReference(workers, "Edit")).toEqual({ kind: "not-found" });
  });
});
