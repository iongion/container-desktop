// Neutral IPC channel + payload contract for the AI subsystem. Shared by the main
// broker (aiBroker.ts) and the shell client/bus bindings so both agree. No SDK imports.

import type { z } from "zod";
import type { AIDiagnosticsSnapshot } from "./diagnostics";
import type { invokeSchemas, pushSchemas, responseSchemas } from "./schemas";
import type { ListedModel } from "./types";

export const AI_CHANNELS = {
  status: "ai:status", // invoke → AIStatus
  diagnostics: "ai:diagnostics",
  keyHas: "ai:key:has", // invoke({ provider }) → boolean
  keySet: "ai:key:set", // invoke({ provider, key, allowDegraded? }) → { ok: true }
  keyClear: "ai:key:clear", // invoke({ provider }) → { ok: true }
  threadSubmit: "ai:thread:submit",
  threadList: "ai:thread:list",
  threadCreate: "ai:thread:create",
  threadRename: "ai:thread:rename",
  threadConfigure: "ai:thread:configure",
  threadBranchPreview: "ai:thread:branch-preview",
  threadBranch: "ai:thread:branch",
  threadCompactionPreview: "ai:thread:compaction-preview",
  threadCompact: "ai:thread:compact",
  threadResolveApproval: "ai:thread:resolve-approval",
  threadSnapshot: "ai:thread:snapshot",
  toolArtifactGet: "ai:tool-artifact:get",
  threadDelete: "ai:thread:delete",
  threadEvent: "ai:thread:event",
  threadStop: "ai:thread:stop",
  changesStatus: "ai:changes:status",
  changesDiff: "ai:changes:diff",
  projectContextSnapshot: "ai:project-context:snapshot",
  projectRulesSetEnabled: "ai:project-context:rules-enabled",
  projectRulesInitialize: "ai:project-context:rules-initialize",
  projectMemoryAdd: "ai:project-context:memory-add",
  projectMemoryRemove: "ai:project-context:memory-remove",
  projectMemoryClear: "ai:project-context:memory-clear",
  projectMemoryImport: "ai:project-context:memory-import",
  // Team Runs execute one Goal through multiple agents. Parallel to Threads, with a task-DAG RunView
  // projection rather than the linear Thread timeline.
  runStart: "ai:run:start", // invoke(StartRunRequest) → StartRunResult
  runCancel: "ai:run:cancel",
  runApprovePlan: "ai:run:approve-plan", // invoke({ runId, decision }) → ResolveRunPlanResult
  runApproveTool: "ai:run:approve-tool", // invoke({ runId, approvalId, decision }) → ResolveRunPlanResult
  runSnapshot: "ai:run:snapshot",
  runEvent: "ai:run:event",
  runList: "ai:run:list", // invoke() → { runs: RunView[] } — the runs the HOST still holds, for re-attach
  // The workers library — reusable agent definitions (model, prompt, tool policy). Broker-owned writes to a
  // dedicated versioned file, exactly like the permission record: the renderer never names a policy inline.
  workersList: "ai:workers:list", // invoke() → { workers }
  workersSave: "ai:workers:save", // invoke({ worker }) → { workers }
  workersRemove: "ai:workers:remove", // invoke({ id }) → { workers }
  // The avatar library — custom uploaded faces a worker references by id. Broker-owned writes to a dedicated
  // versioned file (ai-avatars.json), parallel to the workers store. Presets are shipped assets, never stored.
  avatarsList: "ai:avatars:list", // invoke() → { avatars }
  avatarsSave: "ai:avatars:save", // invoke({ avatar }) → { avatars }
  avatarsRemove: "ai:avatars:remove", // invoke({ id }) → { avatars }
  modelsList: "ai:models:list", // invoke({ providerId }) → { models }
  modelsCancel: "ai:models:cancel",
  // The user-managed allow/reject record (a dedicated versioned file; broker-owned writes).
  permissionsList: "ai:permissions:list", // invoke() → PermissionsSnapshot
  permissionsRemove: "ai:permissions:remove", // invoke({ list, key }) → PermissionsSnapshot
  skillsSnapshot: "ai:skills:snapshot",
  skillsReload: "ai:skills:reload",
  skillsSetProjectSource: "ai:skills:project-source",
  skillsSetProjectTrust: "ai:skills:project-trust",
  skillsInvoke: "ai:skills:invoke",
  skillsChanged: "ai:skills:changed",
  // The knowledge bank has no renderer surface — the agent searches it main-side (see tools.ts).
} as const;

export interface AIStatus {
  encryption: { available: boolean; backend?: string; degraded: boolean };
  webSearchAvailable: boolean;
}

export interface ModelsListResult {
  models: ListedModel[];
}

export type { AIDiagnosticsSnapshot };

// Channel groupings derive from AI_CHANNELS (the independent constant), so the boundary schemas in
// schemas.ts can be key-checked against them (`satisfies Record<AIInvokeChannel, …>`) with no import cycle.
type AIChannel = (typeof AI_CHANNELS)[keyof typeof AI_CHANNELS];
export type AIPushChannel =
  | (typeof AI_CHANNELS)["threadEvent"]
  | (typeof AI_CHANNELS)["runEvent"]
  | (typeof AI_CHANNELS)["skillsChanged"];
export type AIInvokeChannel = Exclude<AIChannel, AIPushChannel>;

// Request/response shapes derive from those schemas — one source of truth, no hand-kept twin that can drift.
// Client payloads are the pre-parse input, broker/renderer values the post-parse output (identical while no
// schema uses a transform/default, but the split stays correct if one is ever added).
export type AIInvokeMap = {
  [K in AIInvokeChannel]: {
    request: z.input<(typeof invokeSchemas)[K]>;
    response: z.output<(typeof responseSchemas)[K]>;
  };
};
export type AIInvokeRequest<TChannel extends AIInvokeChannel> = AIInvokeMap[TChannel]["request"];
export type AIInvokeResponse<TChannel extends AIInvokeChannel> = AIInvokeMap[TChannel]["response"];

export type AIPushMap = { [K in AIPushChannel]: z.output<(typeof pushSchemas)[K]> };
export type AIPushPayload<TChannel extends AIPushChannel> = AIPushMap[TChannel];
