// The ONE mapping of the typed AI client surface (IAI / IAIBus) ↔ the broker's AI_CHANNELS protocol. Both shells
// expose window.AI / window.AIBus from here, injecting only their transport primitive: Electron relays over
// ipcRenderer (preload), Tauri dispatches to the in-webview broker handlers. The shell-specific aiClient.ts /
// aiBus.ts modules stay thin and parallel by construction. Neutral: no electron/@tauri-apps here.

import {
  AI_CHANNELS,
  type AIInvokeChannel,
  type AIInvokeRequest,
  type AIInvokeResponse,
  type AIPushChannel,
  type AIPushPayload,
  type AIStatus,
  type ModelsListResult,
} from "@/ai-system/core/channels";
import type {
  ChatSessionView,
  ResolveChatApprovalRequest,
  ResolveChatApprovalResult,
  SubmitChatRequest,
  SubmitChatResult,
} from "@/ai-system/core/chatEvents";
import type { ConversationSummary, CreateConversationRequest } from "@/ai-system/core/conversations";
import type { PermissionsList, PermissionsSnapshot } from "@/ai-system/core/permissions";
import type { ResolveGoalPlanResult, RunView, StartGoalRequest, StartGoalResult } from "@/ai-system/core/runEvents";
import { validateAIInvokeResponse, validateAIPushPayload } from "@/ai-system/core/schemas";
import type { ApprovalDecision } from "@/ai-system/core/types";
import type { WorkerDefinition } from "@/ai-system/core/workers";

export interface IAI {
  status: () => Promise<AIStatus>;
  hasKey: (provider: string) => Promise<boolean>;
  setKey: (provider: string, key: string, opts?: { allowDegraded?: boolean }) => Promise<{ ok: true }>;
  clearKey: (provider: string) => Promise<{ ok: true }>;
  submitChat: (request: SubmitChatRequest) => Promise<SubmitChatResult>;
  listChats: () => Promise<ConversationSummary[]>;
  createChat: (request: CreateConversationRequest) => Promise<ConversationSummary>;
  resolveChatApproval: (request: ResolveChatApprovalRequest) => Promise<ResolveChatApprovalResult>;
  stopChat: (sessionId: string) => Promise<{ ok: true }>;
  getChatSnapshot: (sessionId: string) => Promise<ChatSessionView | null>;
  deleteChat: (sessionId: string) => Promise<{ ok: true }>;
  startGoal: (request: StartGoalRequest) => Promise<StartGoalResult>;
  approveGoalPlan: (runId: string, decision: ApprovalDecision) => Promise<ResolveGoalPlanResult>;
  approveGoalTool: (runId: string, approvalId: string, decision: ApprovalDecision) => Promise<ResolveGoalPlanResult>;
  stopGoal: (runId: string) => Promise<{ ok: true }>;
  getGoalSnapshot: (runId: string) => Promise<RunView | null>;
  // Runs the HOST still holds — how the Goals screen re-attaches after a renderer reload.
  listGoalRuns: () => Promise<{ runs: RunView[] }>;
  listModels: (providerId?: string, requestId?: string) => Promise<ModelsListResult>;
  cancelModelList: (requestId: string) => Promise<{ ok: true }>;
  listPermissions: () => Promise<PermissionsSnapshot>;
  removePermission: (list: PermissionsList, key: string) => Promise<PermissionsSnapshot>;
  setWebPermission: (verdict: "allow" | "block" | null) => Promise<PermissionsSnapshot>;
  // The workers library. Every mutation answers with the whole library, so the renderer never merges by hand.
  listWorkers: () => Promise<{ workers: WorkerDefinition[] }>;
  saveWorker: (worker: WorkerDefinition) => Promise<{ workers: WorkerDefinition[] }>;
  removeWorker: (id: string) => Promise<{ workers: WorkerDefinition[] }>;
}

export interface IAIBus {
  subscribe: <TChannel extends AIPushChannel>(
    channel: TChannel,
    callback: (payload: AIPushPayload<TChannel>) => void,
  ) => () => void;
}

export interface AIClientTransport {
  invoke: <TChannel extends AIInvokeChannel>(
    channel: TChannel,
    payload?: AIInvokeRequest<TChannel>,
  ) => Promise<unknown>;
}

export function createAIClient(transport: AIClientTransport) {
  const invoke = async <TChannel extends AIInvokeChannel>(
    channel: TChannel,
    payload?: AIInvokeRequest<TChannel>,
  ): Promise<AIInvokeResponse<TChannel>> => validateAIInvokeResponse(channel, await transport.invoke(channel, payload));
  return {
    status: () => invoke(AI_CHANNELS.status),
    hasKey: (provider) => invoke(AI_CHANNELS.keyHas, { provider }),
    setKey: (provider, key, opts) => invoke(AI_CHANNELS.keySet, { provider, key, allowDegraded: opts?.allowDegraded }),
    clearKey: (provider) => invoke(AI_CHANNELS.keyClear, { provider }),
    listChats: () => invoke(AI_CHANNELS.chatList),
    createChat: (request) => invoke(AI_CHANNELS.chatCreate, request),
    submitChat: (request) => invoke(AI_CHANNELS.chatSubmit, request),
    resolveChatApproval: (request) => invoke(AI_CHANNELS.chatResolve, request),
    stopChat: (sessionId) => invoke(AI_CHANNELS.chatCancel, { sessionId }),
    getChatSnapshot: (sessionId) => invoke(AI_CHANNELS.chatSnapshot, { sessionId }),
    deleteChat: (sessionId) => invoke(AI_CHANNELS.chatDispose, { sessionId }),
    startGoal: (request) => invoke(AI_CHANNELS.goalStart, request),
    approveGoalPlan: (runId, decision) => invoke(AI_CHANNELS.goalApprovePlan, { runId, decision }),
    approveGoalTool: (runId, approvalId, decision) =>
      invoke(AI_CHANNELS.goalApproveTool, { runId, approvalId, decision }),
    stopGoal: (runId) => invoke(AI_CHANNELS.goalCancel, { runId }),
    getGoalSnapshot: (runId) => invoke(AI_CHANNELS.goalSnapshot, { runId }),
    listGoalRuns: () => invoke(AI_CHANNELS.goalList),
    listModels: (providerId, requestId = crypto.randomUUID()) =>
      invoke(AI_CHANNELS.modelsList, { providerId, requestId }),
    cancelModelList: (requestId) => invoke(AI_CHANNELS.modelsCancel, { requestId }),
    // The user-managed allow/reject record — managed from Settings → AI permissions.
    listPermissions: () => invoke(AI_CHANNELS.permissionsList),
    removePermission: (list, key) => invoke(AI_CHANNELS.permissionsRemove, { list, key }),
    setWebPermission: (verdict) => invoke(AI_CHANNELS.permissionsSetWeb, { verdict }),
    listWorkers: () => invoke(AI_CHANNELS.workersList),
    saveWorker: (worker) => invoke(AI_CHANNELS.workersSave, { worker }),
    removeWorker: (id) => invoke(AI_CHANNELS.workersRemove, { id }),
  } satisfies IAI;
}

// The receive side. A shell provides a raw channel subscription; this enforces the allowlist (only the streamed
// AI push channel is subscribable, mirroring the resource bus) so a renderer can't attach to arbitrary channels.
export interface AIBusTransport {
  subscribe: <TChannel extends AIPushChannel>(channel: TChannel, listener: (payload: unknown) => void) => () => void;
}

export function createAIBus(transport: AIBusTransport) {
  const SUBSCRIBABLE = new Set<AIPushChannel>([AI_CHANNELS.chatEvent, AI_CHANNELS.goalEvent]);
  return {
    subscribe(channel, callback) {
      if (!SUBSCRIBABLE.has(channel)) {
        throw new Error(`AIBus: subscribe not allowed for channel "${channel}"`);
      }
      // A throwing subscriber must never break delivery — wrap once, centrally, for both shells.
      const safe = (payload: unknown) => {
        try {
          callback(validateAIPushPayload(channel, payload));
        } catch {
          // swallow — matches resourceBus.ts
        }
      };
      return transport.subscribe(channel, safe);
    },
  } satisfies IAIBus;
}
