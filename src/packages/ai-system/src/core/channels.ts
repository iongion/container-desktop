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
  // Write the coding agent gateway's private env file, with the provider key read from the OS keychain and
  // put in host-side. The renderer cannot read that key — only ask for the file that carries it.
  agentGatewayEnv: "ai:agent:gateway-env",
  // invoke({ fileName, contents }) → { path }. The AGENT container's env file, written into the same protected
  // directory as the gateway's so one guard covers both. Carries the bridge token, never a provider key.
  agentEnvFile: "ai:agent:env-file", // invoke(AgentGatewayEnvRequest) → { path }
  // invoke({ provider, fileName, bridgeToken, bridgePort }) → { path }. The one-shot auth container's env file for a
  // REFRESH run: it carries the stored credential, put in host-side, because the web view cannot read one out of the
  // vault. Same protected directory and same guard as the two above.
  authRefreshEnv: "ai:auth:refresh-env",
  changesStatus: "ai:changes:status",
  changesDiff: "ai:changes:diff",
  projectContextSnapshot: "ai:project-context:snapshot",
  projectRulesSetEnabled: "ai:project-context:rules-enabled",
  projectRulesInitialize: "ai:project-context:rules-initialize",
  projectMemoryAdd: "ai:project-context:memory-add",
  projectMemoryRemove: "ai:project-context:memory-remove",
  projectMemoryClear: "ai:project-context:memory-clear",
  projectMemoryImport: "ai:project-context:memory-import",
  modelsList: "ai:models:list", // invoke({ providerId }) → { models }
  modelsCancel: "ai:models:cancel",
  // invoke({ providerId?, model }) → { contextWindow?, maxOutputTokens? }. Asked of the PROVIDER, because the
  // OpenAI-shaped listing carries no window and a made-up one promises room a server will refuse.
  modelWindow: "ai:model:window",
  // The user-managed allow/reject record (a dedicated versioned file; broker-owned writes).
  permissionsList: "ai:permissions:list", // invoke() → PermissionsSnapshot
  permissionsAdd: "ai:permissions:add", // invoke({ list, rule }) → PermissionsSnapshot
  permissionsRemove: "ai:permissions:remove", // invoke({ list, key }) → PermissionsSnapshot
  skillsSnapshot: "ai:skills:snapshot",
  skillsReload: "ai:skills:reload",
  skillsSetProjectSource: "ai:skills:project-source",
  skillsSetProjectTrust: "ai:skills:project-trust",
  skillsInvoke: "ai:skills:invoke",
  skillsChanged: "ai:skills:changed",
  // One container-engine operation, performed on the agent's behalf. The coding agent runs inside a container
  // and cannot reach the engine ports, so its container toolset executes here, where engineOps is bound.
  engineOp: "ai:engine:op", // invoke({ op, args?, defaultConnectionId? }) → EngineOpResult
  // One workspace file or command operation, performed for the agent WHERE the session chose: this machine, a
  // connection's own host, a container on one, or a disposable sandbox. It executes here because only this realm
  // holds the connection transports and the local filesystem — the agent container can reach none of them.
  workspaceOp: "ai:workspace:op", // invoke({ op, args?, target, runId }) → WorkspaceOpResult
  // Release what a session's targets built — above all the disposable sandbox container, which exists only for
  // that run and would otherwise outlive the session that asked for it.
  workspaceRelease: "ai:workspace:release", // invoke({ runId }) → { ok: true }
  // One public-web query, run for the agent. It executes here because the app owns the address-pinned fetch and
  // the user's own web-search switch — which this refuses on while it is off.
  webSearch: "ai:web:search", // invoke({ query }) → { text }
  // The knowledge bank has no channel: its entries ship inside the agent image, so the session's own
  // `searchKnowledge` tool answers from there without asking the app for anything.
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
export type AIPushChannel = (typeof AI_CHANNELS)["skillsChanged"];
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
