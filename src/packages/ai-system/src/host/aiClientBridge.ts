// The ONE mapping of the typed AI client surface (IAI / IAIBus) ↔ the broker's AI_CHANNELS protocol. Both shells
// expose window.AI / window.AIBus from here, injecting only their transport primitive — both dispatch to the
// in-webview broker handlers, since the broker shares their realm. The shell-specific aiClient.ts /
// aiBus.ts modules stay thin and parallel by construction. Neutral: no @tauri-apps/@wailsio here.

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
import type { PermissionRule, PermissionsList, PermissionsSnapshot } from "@/ai-system/core/permissions";
import type { ProjectContextSnapshot } from "@/ai-system/core/projectContext";
import { validateAIInvokeResponse, validateAIPushPayload } from "@/ai-system/core/schemas";
import type { ResolveSkillInvocationRequest, SkillHostSnapshot } from "@/ai-system/core/skills";
import type {
  ThreadCompactionExecutionResult,
  ThreadCompactionPreview,
  ThreadCompactionRevision,
} from "@/ai-system/core/threadCompaction";
import type {
  ResolveThreadApprovalRequest,
  ResolveThreadApprovalResult,
  SubmitThreadRequest,
  SubmitThreadResult,
  ThreadView,
} from "@/ai-system/core/threadEvents";
import type {
  CreateThreadRequest,
  ThreadBranchPreview,
  ThreadBranchResult,
  ThreadConfigurationPatch,
  ThreadSummary,
} from "@/ai-system/core/threads";
import type { ToolArtifactRecord } from "@/ai-system/core/toolArtifacts";
import type { WorkspaceChangeSnapshot, WorkspaceDiff } from "@/ai-system/core/workspaceChanges";
import type { EngineOpResult } from "@/pi-bridge/protocol";

export interface IAI {
  status: () => Promise<AIStatus>;
  diagnostics: (providerId?: string) => Promise<import("@/ai-system/core/diagnostics").AIDiagnosticsSnapshot>;
  hasKey: (provider: string) => Promise<boolean>;
  setKey: (provider: string, key: string, opts?: { allowDegraded?: boolean }) => Promise<{ ok: true }>;
  clearKey: (provider: string) => Promise<{ ok: true }>;
  submitToThread: (request: SubmitThreadRequest) => Promise<SubmitThreadResult>;
  listThreads: () => Promise<ThreadSummary[]>;
  createThread: (request: CreateThreadRequest) => Promise<ThreadSummary>;
  renameThread: (threadId: string, title: string) => Promise<ThreadSummary>;
  configureThread: (threadId: string, patch: ThreadConfigurationPatch) => Promise<ThreadSummary>;
  previewThreadBranch: (threadId: string) => Promise<ThreadBranchPreview>;
  branchThread: (threadId: string, checkpointId: string, title: string) => Promise<ThreadBranchResult>;
  previewThreadCompaction: (threadId: string) => Promise<ThreadCompactionPreview>;
  compactThread: (
    threadId: string,
    revision: ThreadCompactionRevision,
    instructions?: string,
  ) => Promise<ThreadCompactionExecutionResult>;
  resolveThreadApproval: (request: ResolveThreadApprovalRequest) => Promise<ResolveThreadApprovalResult>;
  stopThread: (threadId: string) => Promise<{ ok: true }>;
  getThreadSnapshot: (threadId: string) => Promise<ThreadView | null>;
  getToolArtifact: (threadId: string, artifactId: string) => Promise<ToolArtifactRecord>;
  deleteThread: (threadId: string) => Promise<{ ok: true }>;
  getWorkspaceChangeStatus: () => Promise<WorkspaceChangeSnapshot>;
  getWorkspaceDiff: () => Promise<WorkspaceDiff>;
  getProjectContext: () => Promise<ProjectContextSnapshot>;
  setProjectRulesEnabled: (enabled: boolean) => Promise<ProjectContextSnapshot>;
  initializeProjectRules: () => Promise<{ result: "created" | "exists"; snapshot: ProjectContextSnapshot }>;
  addProjectMemory: (content: string) => Promise<ProjectContextSnapshot>;
  removeProjectMemory: (id: string) => Promise<ProjectContextSnapshot>;
  clearProjectMemory: () => Promise<ProjectContextSnapshot>;
  importProjectMemory: (content: string) => Promise<ProjectContextSnapshot>;
  listModels: (providerId?: string, requestId?: string) => Promise<ModelsListResult>;
  cancelModelList: (requestId: string) => Promise<{ ok: true }>;
  // One container-engine operation on the coding agent's behalf. Answers with a result rather than throwing:
  // the caller is settling a request a containerized agent is blocked on.
  runEngineOp: (request: {
    op: string;
    args?: Record<string, unknown>;
    defaultConnectionId?: string;
  }) => Promise<EngineOpResult>;
  listPermissions: () => Promise<PermissionsSnapshot>;
  addPermission: (list: PermissionsList, rule: PermissionRule) => Promise<PermissionsSnapshot>;
  removePermission: (list: PermissionsList, key: string) => Promise<PermissionsSnapshot>;
  getSkills: () => Promise<SkillHostSnapshot>;
  reloadSkills: () => Promise<SkillHostSnapshot>;
  setProjectSkillsEnabled: (enabled: boolean) => Promise<SkillHostSnapshot>;
  setProjectSkillTrust: (skillId: string, expectedFingerprint: string, trusted: boolean) => Promise<SkillHostSnapshot>;
  // Resolves and renders the skill; the caller submits the prompt to the pi session. The result type derives
  // from the channel schema, so it cannot drift from what the broker actually answers.
  invokeSkill: (
    request: ResolveSkillInvocationRequest,
  ) => Promise<AIInvokeResponse<(typeof AI_CHANNELS)["skillsInvoke"]>>;
  // The workers library. Every mutation answers with the whole library, so the renderer never merges by hand.
  // The avatar library — custom uploaded faces. Every mutation answers with the whole library, like workers.
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
    diagnostics: (providerId) => invoke(AI_CHANNELS.diagnostics, { providerId }),
    hasKey: (provider) => invoke(AI_CHANNELS.keyHas, { provider }),
    setKey: (provider, key, opts) => invoke(AI_CHANNELS.keySet, { provider, key, allowDegraded: opts?.allowDegraded }),
    clearKey: (provider) => invoke(AI_CHANNELS.keyClear, { provider }),
    listThreads: () => invoke(AI_CHANNELS.threadList),
    createThread: (request) => invoke(AI_CHANNELS.threadCreate, request),
    renameThread: (threadId, title) => invoke(AI_CHANNELS.threadRename, { threadId, title }),
    configureThread: (threadId, patch) => invoke(AI_CHANNELS.threadConfigure, { threadId, ...patch }),
    previewThreadBranch: (threadId) => invoke(AI_CHANNELS.threadBranchPreview, { threadId }),
    branchThread: (threadId, checkpointId, title) =>
      invoke(AI_CHANNELS.threadBranch, { threadId, checkpointId, title }),
    previewThreadCompaction: (threadId) => invoke(AI_CHANNELS.threadCompactionPreview, { threadId }),
    compactThread: (threadId, revision, instructions) =>
      invoke(AI_CHANNELS.threadCompact, { threadId, revision, instructions }),
    submitToThread: (request) => invoke(AI_CHANNELS.threadSubmit, request),
    resolveThreadApproval: (request) => invoke(AI_CHANNELS.threadResolveApproval, request),
    stopThread: (threadId) => invoke(AI_CHANNELS.threadStop, { threadId }),
    getThreadSnapshot: (threadId) => invoke(AI_CHANNELS.threadSnapshot, { threadId }),
    getToolArtifact: (threadId, artifactId) => invoke(AI_CHANNELS.toolArtifactGet, { threadId, artifactId }),
    deleteThread: (threadId) => invoke(AI_CHANNELS.threadDelete, { threadId }),
    getWorkspaceChangeStatus: () => invoke(AI_CHANNELS.changesStatus),
    getWorkspaceDiff: () => invoke(AI_CHANNELS.changesDiff),
    getProjectContext: () => invoke(AI_CHANNELS.projectContextSnapshot),
    setProjectRulesEnabled: (enabled) => invoke(AI_CHANNELS.projectRulesSetEnabled, { enabled }),
    initializeProjectRules: () => invoke(AI_CHANNELS.projectRulesInitialize),
    addProjectMemory: (content) => invoke(AI_CHANNELS.projectMemoryAdd, { content }),
    removeProjectMemory: (id) => invoke(AI_CHANNELS.projectMemoryRemove, { id }),
    clearProjectMemory: () => invoke(AI_CHANNELS.projectMemoryClear),
    importProjectMemory: (content) => invoke(AI_CHANNELS.projectMemoryImport, content),
    listModels: (providerId, requestId = crypto.randomUUID()) =>
      invoke(AI_CHANNELS.modelsList, { providerId, requestId }),
    cancelModelList: (requestId) => invoke(AI_CHANNELS.modelsCancel, { requestId }),
    runEngineOp: (request) => invoke(AI_CHANNELS.engineOp, request),
    // The user-managed allow/reject record — managed from Settings → AI permissions.
    listPermissions: () => invoke(AI_CHANNELS.permissionsList),
    addPermission: (list, rule) => invoke(AI_CHANNELS.permissionsAdd, { list, rule }),
    removePermission: (list, key) => invoke(AI_CHANNELS.permissionsRemove, { list, key }),
    getSkills: () => invoke(AI_CHANNELS.skillsSnapshot),
    reloadSkills: () => invoke(AI_CHANNELS.skillsReload),
    setProjectSkillsEnabled: (enabled) => invoke(AI_CHANNELS.skillsSetProjectSource, { enabled }),
    setProjectSkillTrust: (skillId, expectedFingerprint, trusted) =>
      invoke(AI_CHANNELS.skillsSetProjectTrust, { skillId, expectedFingerprint, trusted }),
    invokeSkill: (request) => invoke(AI_CHANNELS.skillsInvoke, request),
  } satisfies IAI;
}

// The receive side. A shell provides a raw channel subscription; this enforces the allowlist (only the streamed
// AI push channel is subscribable, mirroring the resource bus) so a renderer can't attach to arbitrary channels.
export interface AIBusTransport {
  subscribe: <TChannel extends AIPushChannel>(channel: TChannel, listener: (payload: unknown) => void) => () => void;
}

export function createAIBus(transport: AIBusTransport) {
  const SUBSCRIBABLE = new Set<AIPushChannel>([AI_CHANNELS.threadEvent, AI_CHANNELS.skillsChanged]);
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
