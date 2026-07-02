// Neutral IPC channel + payload contract for the AI subsystem. Shared by the main
// broker (aiBroker.ts) and the preload forwarder (aiClient.ts) so both agree. No Electron/SDK imports.

import type { ChatMessage } from "./chatStore";
import type { PermissionsList, PermissionsSnapshot } from "./permissions";
import type { ListedModel } from "./types";

export const AI_CHANNELS = {
  status: "ai:status", // invoke → AIStatus
  keyHas: "ai:key:has", // invoke({ provider }) → boolean
  keySet: "ai:key:set", // invoke({ provider, key, allowDegraded? }) → { ok: true }
  keyClear: "ai:key:clear", // invoke({ provider }) → { ok: true }
  preview: "ai:preview", // invoke({ payload }) → { payload, text }  (redacted)
  egressCheck: "ai:egress:check", // invoke({ providerId }) → EgressDecision
  // The one always-agentic conversation channel: streams prose deltas + a gated tool timeline.
  chat: "ai:chat", // invoke({ ...ChatRequest }) → { streamId }
  chatCancel: "ai:chat:cancel", // message({ streamId }) → (push stops)
  // Resolve a pending tool approval the agent surfaced: run/persist per mode, then resume the turn.
  agentResolve: "ai:agent:resolve", // message({ streamId, actionId, decision }) → (push resumes)
  generate: "ai:generate", // invoke({ ...GenerateRequest }) → { streamId }
  modelsList: "ai:models:list", // invoke({ providerId }) → { models }
  // The user-managed allow/reject record (a dedicated versioned file; broker-owned writes).
  permissionsList: "ai:permissions:list", // invoke() → PermissionsSnapshot
  permissionsRemove: "ai:permissions:remove", // invoke({ list, key }) → PermissionsSnapshot
  permissionsSetWeb: "ai:permissions:set-web", // invoke({ verdict }) → PermissionsSnapshot
  // The knowledge bank has no renderer surface — the agent searches it main-side (see tools.ts).
  // Push channel for streaming (chat deltas / agent timeline / model progress).
  streamEvent: "ai:stream-event", // main → renderer (push): { streamId, type, payload }
} as const;

export interface AIStatus {
  encryption: { available: boolean; backend?: string; degraded: boolean };
}

export interface ChatRequest {
  sessionId: string;
  messages: ChatMessage[];
  providerId?: string;
  model?: string;
  /** Live engine/diagnostics context the renderer assembles for this turn (redacted main-side). */
  bundle?: DiagnosticsBundle;
}

export interface ChatStreamEvent {
  streamId: string;
  type: "delta" | "done" | "error";
  payload: { text?: string; finishReason?: string; message?: string };
}

export interface ModelsListResult {
  models: ListedModel[];
}

// One-shot Containerfile/Compose generation. Streams its result over the same streamEvent channel.
export interface GenerateRequest {
  kind: "containerfile" | "compose";
  template?: string;
  instruction?: string;
  providerId?: string;
}

// Agent tool timeline
// Timeline events the agent's tools emit; streamed into the Assistant transcript and (for
// command-result) also serve as the model-facing record. Neutral contract shared by renderer + tools.
// An approval-request carries a broker-generated `actionId` — the renderer echoes it back in a resolve
// so the broker matches the exact pending action; `kind` selects the command vs web-search card. For a
// web approval `args` holds the single query string.
export type AgentToolEvent =
  | { type: "command"; program: string; args: string[] }
  | {
      type: "approval-request";
      actionId: string;
      kind: "command" | "web" | "tool";
      program: string;
      args: string[];
      reason: string;
      /** Typed first-class tool (kind === "tool"): the engine op + its args, so the broker can re-run it on
       *  approval, and a friendly one-line summary for the approval card. */
      tool?: string;
      toolArgs?: Record<string, unknown>;
      title?: string;
    }
  | { type: "command-result"; program: string; args: string[]; ok: boolean; stdout: string; stderr: string }
  | { type: "rejected"; program: string; args: string[]; reason: string }
  // First-class typed tools — a call badge then its (redacted) typed result, rendered as a generative-UI
  // card by the renderer (transcript `tool` item → cards registry). `args`/`result` are already redacted.
  | { type: "tool-call"; tool: string; title: string; args: Record<string, unknown> }
  | { type: "tool-result"; tool: string; title: string; ok: boolean; result: unknown };

// Live engine/diagnostics context the RENDERER assembles (activity/resource/engine stores it owns) and
// attaches to a chat turn. Pre-serialized to strings; main redacts before the model sees it. `resources`
// carries the compact live connection/resource summary (resourceContext.ts).
export interface DiagnosticsBundle {
  os?: string;
  engine?: string;
  connection?: string;
  activity?: string;
  resources?: string;
  errors?: string;
}

// A user's decision on a surfaced approval. A reject NEVER runs; an allow runs (and, in "remember"
// mode, persists the verdict).
export type ResolveDecision = "allow" | "reject";

// Stream events for an agent run: prose deltas, tool-timeline entries, completion, error.
export interface AgentStreamEvent {
  streamId: string;
  type: "delta" | "tool" | "done" | "error";
  payload: { text?: string; finishReason?: string; message?: string; event?: AgentToolEvent };
}

// Preload bridge contracts (IAI / IAIBus)
// These are type-only declarations owned by core so global.d.ts can import them rather than
// re-declaring inline. The concrete implementations live in adapters/electron/preload.

export interface IAI {
  status: () => Promise<AIStatus>;
  hasKey: (provider: string) => Promise<boolean>;
  setKey: (provider: string, key: string, opts?: { allowDegraded?: boolean }) => Promise<{ ok: true }>;
  clearKey: (provider: string) => Promise<{ ok: true }>;
  preview: (payload: unknown) => Promise<{ payload: any; text: string }>;
  egressCheck: (providerId?: string) => Promise<import("./egress").EgressDecision>;
  chat: (req: ChatRequest) => Promise<{ streamId: string }>;
  cancelChat: (streamId: string) => void;
  /** Resolve a pending tool approval the agent surfaced. Fire-and-forget: the broker runs/persists per
   *  mode and resumes the turn over the stream. A reject never runs. */
  resolve: (streamId: string, actionId: string, decision: ResolveDecision) => void;
  generate: (req: GenerateRequest) => Promise<{ streamId: string }>;
  listModels: (providerId?: string) => Promise<ModelsListResult>;
  /** The user-managed allow/reject record (read + revoke + web switch). Broker owns all writes. */
  listPermissions: () => Promise<PermissionsSnapshot>;
  removePermission: (list: PermissionsList, key: string) => Promise<PermissionsSnapshot>;
  setWebPermission: (verdict: "allow" | "block" | null) => Promise<PermissionsSnapshot>;
}

export interface IAIBus {
  subscribe: (channel: string, callback: (payload: any) => void) => () => void;
}
