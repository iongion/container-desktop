// Where the assistant's tools run and which workspace state they own. OWNED by core: pure data plus the two
// derivations everything else asks for — how strictly the command floor applies there, and a stable key per
// distinct target.

import type { z } from "zod";
import type { FloorScope } from "./commandFloor";
import type { executionTarget } from "./schemas";

// Single-sourced from the boundary schema — no hand-maintained twin that can drift from what the wire accepts.
export type ExecutionTarget = z.infer<typeof executionTarget>;

// Derived purely from where the tools run. A disposable sandbox relaxes the denylist; a container the user already
// depends on keeps the tighter one.
export function floorScopeFor(target: ExecutionTarget): FloorScope {
  return target.kind === "sandbox" ? "sandbox" : "container";
}

// A stable, distinct key per target, so one execution backend is built per target and shared by everything that
// runs there.
export function executionTargetKey(target: ExecutionTarget): string {
  switch (target.kind) {
    case "container":
      return `container:${target.connectionId}:${target.containerId}`;
    case "sandbox":
      return `sandbox:${target.connectionId}:${target.image}`;
  }
}
