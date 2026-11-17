// The ONE mapping of the typed AI client surface (IAI / IAIBus) ↔ the broker's AI_CHANNELS protocol. Both shells
// expose window.AI / window.AIBus from here, injecting only their transport primitive — both dispatch to the
// in-webview broker handlers, since the broker shares their realm. The shell-specific aiClient.ts /
// aiBus.ts modules stay thin and parallel by construction. Neutral: no @tauri-apps/@wailsio here.

import type { ModelWindow } from "@/ai-system/adapters/modelWindow";
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
import type { ExecutionTarget } from "@/ai-system/core/executionTargets";
import type { ProjectContextSnapshot } from "@/ai-system/core/projectContext";
import { validateAIInvokeResponse, validateAIPushPayload } from "@/ai-system/core/schemas";
import type { ResolveSkillInvocationRequest, SkillHostSnapshot } from "@/ai-system/core/skills";
import type { WorkspaceChangeSnapshot, WorkspaceDiff } from "@/ai-system/core/workspaceChanges";
import type { EngineOpResult } from "@/mcp-server/core/engineOpDispatch";
import type { PermissionRule, PermissionsList, PermissionsSnapshot } from "@/mcp-server/core/permissions";
import type { WorkspaceOpResult } from "@/pi-bridge/protocol";

export interface IAI {
  status: () => Promise<AIStatus>;
  diagnostics: (providerId?: string) => Promise<import("@/ai-system/core/diagnostics").AIDiagnosticsSnapshot>;
  hasKey: (provider: string) => Promise<boolean>;
  setKey: (provider: string, key: string, opts?: { allowDegraded?: boolean }) => Promise<{ ok: true }>;
  clearKey: (provider: string) => Promise<{ ok: true }>;
  // The agent container's env file, into the protected agent directory. It carries the bridge token, so it belongs
  // behind the same guard rather than in a directory the web view could read it out of. No session file carries a
  // provider credential any more: the app signs inference itself.
  writeAgentEnvFile: (fileName: string, contents: string) => Promise<{ path: string }>;
  // The directory on this machine the agent mounts its conversations from, created by the host before it answers.
  // This realm cannot name it: where the app keeps its data is the host's to know, and a directory the engine has to
  // create instead belongs to root.
  agentSessionsDir: () => Promise<{ path: string }>;
  // Serve that directory to a pair that cannot mount it. The port is the local end the container's store answers on;
  // the token is the session's own, because this socket carries the whole history.
  serveAgentSessions: (request: { localPort: number; bridgeToken: string }) => Promise<{ ok: boolean }>;
  stopServingAgentSessions: () => Promise<{ ok: boolean }>;
  // The one-shot auth container's env file for a refresh run, and the ONE file a credential is still substituted into:
  // pi's own flow code needs the stored credential to exchange it. This realm names the provider and never sees it.
  writeAuthRefreshEnv: (request: {
    provider: string;
    fileName: string;
    bridgeToken: string;
    bridgePort: number;
  }) => Promise<{ path: string }>;
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
  // What the provider says about the chosen model — its window, its rates, whether it reasons. `{}` when it
  // publishes none of it.
  modelWindow: (model: string, providerId?: string) => Promise<ModelWindow>;
  // Load a model into a local server. Answers the server's own reason when it cannot.
  modelLoad: (model: string, providerId?: string, contextLength?: number) => Promise<{ ok: boolean; error?: string }>;
  cancelModelList: (requestId: string) => Promise<{ ok: true }>;
  // One container-engine operation on the coding agent's behalf. Answers with a result rather than throwing:
  // the caller is settling a request a containerized agent is blocked on.
  runEngineOp: (request: {
    op: string;
    args?: Record<string, unknown>;
    defaultConnectionId?: string;
  }) => Promise<EngineOpResult>;
  // One workspace file or command operation on the agent's behalf, performed WHERE the session chose. Same
  // value-not-throw contract as an engine operation, and for the same reason: a containerized agent is blocked on it.
  runWorkspaceOp: (request: {
    op: string;
    args?: Record<string, unknown>;
    target: ExecutionTarget;
    runId: string;
  }) => Promise<WorkspaceOpResult>;
  // Release what a session's workspace targets built — the disposable sandbox above all.
  releaseWorkspaceTargets: (runId: string) => Promise<{ ok: true }>;
  // One public-web query on the agent's behalf. Throws when the runtime cannot search or the user has web search
  // turned off — the caller turns that into the reason the agent reads.
  runWebSearch: (query: string) => Promise<{ text: string }>;
  // One INFERENCE request on the session's behalf, with the provider key attached in the realm that owns the vault.
  // Settles once the request is accepted; the answer arrives on the `ai:provider:stream` push channel, because an
  // inference response is a stream and an invoke settles once.
  runProviderRequest: (request: {
    requestId: string;
    providerId?: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }) => Promise<{ ok: true }>;
  // pi dropped its client mid-answer. Stops the app pulling bytes the user is billed for and nothing will read.
  cancelProviderRequest: (requestId: string) => Promise<{ ok: true }>;
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
    writeAgentEnvFile: (fileName, contents) => invoke(AI_CHANNELS.agentEnvFile, { fileName, contents }),
    agentSessionsDir: () => invoke(AI_CHANNELS.agentSessionsDir),
    serveAgentSessions: (request) => invoke(AI_CHANNELS.agentSessionsServe, request),
    stopServingAgentSessions: () => invoke(AI_CHANNELS.agentSessionsUnserve),
    writeAuthRefreshEnv: (request) => invoke(AI_CHANNELS.authRefreshEnv, request),
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
    modelWindow: (model, providerId) => invoke(AI_CHANNELS.modelWindow, { model, providerId }),
    modelLoad: (model, providerId, contextLength) =>
      invoke(AI_CHANNELS.modelLoad, { model, providerId, contextLength }),
    runEngineOp: (request) => invoke(AI_CHANNELS.engineOp, request),
    runWorkspaceOp: (request) => invoke(AI_CHANNELS.workspaceOp, request),
    releaseWorkspaceTargets: (runId) => invoke(AI_CHANNELS.workspaceRelease, { runId }),
    runWebSearch: (query) => invoke(AI_CHANNELS.webSearch, { query }),
    runProviderRequest: (request) => invoke(AI_CHANNELS.providerRequest, request),
    cancelProviderRequest: (requestId) => invoke(AI_CHANNELS.providerCancel, { requestId }),
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
  const SUBSCRIBABLE = new Set<AIPushChannel>([AI_CHANNELS.skillsChanged, AI_CHANNELS.providerStream]);
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
