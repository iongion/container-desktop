import { describe, expect, it } from "vitest";

import type { RunTaskView } from "@/ai-system/core/runEvents";
import { runGraphEdges } from "./dagEdges";

const task = (id: string, dependsOn: string[] = []): RunTaskView => ({
  id,
  title: id,
  description: "",
  dependsOn,
  agent: "agent",
  status: "pending",
  output: "",
  error: "",
});

describe("runGraphEdges", () => {
  it("returns no edges when nothing depends on anything", () => {
    expect(runGraphEdges([task("a"), task("b")])).toEqual([]);
  });

  it("emits one edge per dependency, upstream -> dependent", () => {
    const edges = runGraphEdges([task("a"), task("b", ["a"])]);
    expect(edges).toEqual([{ from: "a", to: "b" }]);
  });

  it("fans a multi-dependency task in from each upstream", () => {
    const edges = runGraphEdges([task("a"), task("b"), task("c", ["a", "b"])]);
    expect(edges).toEqual([
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ]);
  });

  it("drops a dependency on an id that is not in the plan (no node to attach to)", () => {
    expect(runGraphEdges([task("b", ["ghost"])])).toEqual([]);
  });

  it("collapses duplicate dependencies and ignores a self-dependency", () => {
    const edges = runGraphEdges([task("a"), task("b", ["a", "a", "b"])]);
    expect(edges).toEqual([{ from: "a", to: "b" }]);
  });
});
