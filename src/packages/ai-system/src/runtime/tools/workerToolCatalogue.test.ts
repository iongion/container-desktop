// The worker editor reads core/workerTools; the loops execute runtime/tools/*Specs. Both state which tools exist
// and which are gated, so they can drift — an editor offering a tool the loop cannot run, or (worse) presenting a
// destructive tool as ungated. These assert equality in BOTH directions so either side changing alone fails here.

import { describe, expect, it } from "vitest";

import { CONTAINER_TOOL_NAMES } from "@/ai-system/core/toolNames";
import { WORKER_TOOL_CATALOGUE } from "@/ai-system/core/workerTools";
import { WORKSPACE_TOOL_NAMES } from "@/ai-system/core/workspaceToolNames";
import { CONTAINER_TOOL_SPECS } from "./containerToolSpecs";
import { WORKSPACE_TOOL_SPECS } from "./workspaceToolSpecs";

describe("worker tool catalogue", () => {
  it("covers every container tool exactly once, with the spec's gated flag", () => {
    const entries = WORKER_TOOL_CATALOGUE.filter((entry) => entry.group === "container");
    expect(entries.map((entry) => entry.name).sort()).toEqual([...CONTAINER_TOOL_NAMES].sort());
    for (const entry of entries) {
      const spec = CONTAINER_TOOL_SPECS[entry.name as keyof typeof CONTAINER_TOOL_SPECS];
      expect(spec, `no runtime spec for container tool ${entry.name}`).toBeDefined();
      expect(entry.gated, `gated mismatch for ${entry.name}`).toBe(spec?.gated);
    }
  });

  it("covers every workspace tool exactly once, with the spec's gated flag", () => {
    const entries = WORKER_TOOL_CATALOGUE.filter((entry) => entry.group === "workspace");
    expect(entries.map((entry) => entry.name).sort()).toEqual([...WORKSPACE_TOOL_NAMES].sort());
    for (const entry of entries) {
      const spec = WORKSPACE_TOOL_SPECS[entry.name as keyof typeof WORKSPACE_TOOL_SPECS];
      expect(spec, `no runtime spec for workspace tool ${entry.name}`).toBeDefined();
      expect(entry.gated, `gated mismatch for ${entry.name}`).toBe(spec.gated);
    }
  });

  it("names no tool the runtime cannot execute", () => {
    const runnable = new Set<string>([...Object.keys(CONTAINER_TOOL_SPECS), ...Object.keys(WORKSPACE_TOOL_SPECS)]);
    for (const entry of WORKER_TOOL_CATALOGUE) {
      expect(runnable.has(entry.name), `catalogue offers ${entry.name} but no spec runs it`).toBe(true);
    }
  });
});
