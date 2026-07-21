// Neutral IPC channel + payload contract for the AI subsystem. Shared by the main
// broker (aiBroker.ts) and the shell client/bus bindings so both agree. No Electron/SDK imports.

import type { z } from "zod";
import type { invokeSchemas, pushSchemas, responseSchemas } from "./schemas";
import type { ListedModel } from "./types";

export const AI_CHANNELS = {
  status: "ai:status", // invoke → AIStatus
  keyHas: "ai:key:has", // invoke({ provider }) → boolean
  keySet: "ai:key:set", // invoke({ provider, key, allowDegraded? }) → { ok: true }
  keyClear: "ai:key:clear", // invoke({ provider }) → { ok: true }
  chatSubmit: "ai:chat:submit",
  chatList: "ai:chat:list",
  chatCreate: "ai:chat:create",
  chatResolve: "ai:chat:resolve",
  chatSnapshot: "ai:chat:snapshot",
  chatDispose: "ai:chat:dispose",
  chatEvent: "ai:chat:event",
  chatCancel: "ai:chat:cancel",
  // Goal mode — a multi-agent run over a single goal. Parallel to the chat channels, with its own RunView
  // projection (a task DAG) rather than the linear chat timeline.
  goalStart: "ai:goal:start", // invoke(StartGoalRequest) → StartGoalResult
  goalCancel: "ai:goal:cancel",
  goalApprovePlan: "ai:goal:approve-plan", // invoke({ runId, decision }) → ResolveGoalPlanResult
  goalApproveTool: "ai:goal:approve-tool", // invoke({ runId, approvalId, decision }) → ResolveGoalPlanResult
  goalSnapshot: "ai:goal:snapshot",
  goalEvent: "ai:goal:event",
  goalList: "ai:goal:list", // invoke() → { runs: RunView[] } — the runs the HOST still holds, for re-attach
  // The workers library — reusable agent definitions (model, prompt, tool policy). Broker-owned writes to a
  // dedicated versioned file, exactly like the permission record: the renderer never names a policy inline.
  workersList: "ai:workers:list", // invoke() → { workers }
  workersSave: "ai:workers:save", // invoke({ worker }) → { workers }
  workersRemove: "ai:workers:remove", // invoke({ id }) → { workers }
  modelsList: "ai:models:list", // invoke({ providerId }) → { models }
  modelsCancel: "ai:models:cancel",
  // The user-managed allow/reject record (a dedicated versioned file; broker-owned writes).
  permissionsList: "ai:permissions:list", // invoke() → PermissionsSnapshot
  permissionsRemove: "ai:permissions:remove", // invoke({ list, key }) → PermissionsSnapshot
  permissionsSetWeb: "ai:permissions:set-web", // invoke({ verdict }) → PermissionsSnapshot
  // The knowledge bank has no renderer surface — the agent searches it main-side (see tools.ts).
} as const;

export interface AIStatus {
  encryption: { available: boolean; backend?: string; degraded: boolean };
  webSearchAvailable: boolean;
}

export interface ModelsListResult {
  models: ListedModel[];
}

// Channel groupings derive from AI_CHANNELS (the independent constant), so the boundary schemas in
// schemas.ts can be key-checked against them (`satisfies Record<AIInvokeChannel, …>`) with no import cycle.
type AIChannel = (typeof AI_CHANNELS)[keyof typeof AI_CHANNELS];
export type AIPushChannel = (typeof AI_CHANNELS)["chatEvent"] | (typeof AI_CHANNELS)["goalEvent"];
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
