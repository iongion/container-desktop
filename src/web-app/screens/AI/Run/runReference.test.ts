import { describe, expect, it } from "vitest";
import type { RunView } from "@/ai-system/core/runEvents";
import { emptyRunView } from "@/ai-system/core/runReducer";
import { resolveRunReference } from "@/web-app/screens/AI/Run/runReference";

const run = (runId: string, goal: string): RunView => ({ ...emptyRunView(runId, goal), phase: "running" });

describe("resolveRunReference", () => {
  const runs = [run("run-1", "Audit images"), run("run-2", "Audit images"), run("run-3", "Prune volumes")];

  it("prefers an exact ID, then a unique case-insensitive Goal", () => {
    expect(resolveRunReference(runs, "run-2")).toMatchObject({ kind: "resolved", run: { runId: "run-2" } });
    expect(resolveRunReference(runs, "prune VOLUMES")).toMatchObject({ kind: "resolved", run: { runId: "run-3" } });
  });

  it("never guesses an ambiguous or partial target", () => {
    expect(resolveRunReference(runs, "Audit images")).toEqual({ kind: "ambiguous" });
    expect(resolveRunReference(runs, "Prune")).toEqual({ kind: "not-found" });
  });
});
