import { sha256Text } from "@/ai-system/adapters/sha256";
import {
  AI_CHANNELS,
  type AIInvokeChannel,
  type AIInvokeRequest,
  type AIInvokeResponse,
  type AIPushChannel,
  type AIPushPayload,
  type AIStatus,
} from "@/ai-system/core/channels";
import type { AIRecordedError } from "@/ai-system/core/diagnostics";
import { describeError } from "@/ai-system/core/errors";
import type { PermissionsStoreLike } from "@/ai-system/core/permissions";
import type { AIKeyStore, ExecutionSelectorFactory, KnowledgeBankLike, SandboxRunner } from "@/ai-system/core/ports";
import type { ProjectContextPack } from "@/ai-system/core/projectContext";
import { type ResolvedProvider, resolveProvider } from "@/ai-system/core/providers";
import { redactText } from "@/ai-system/core/redact";
import { validateAIInvokeRequest } from "@/ai-system/core/schemas";
import { SKILL_LIMITS } from "@/ai-system/core/skills";
import { createToolArtifactRecord, toolArtifactReference } from "@/ai-system/core/toolArtifacts";
import type {
  AISettings,
  CompactThreadContext,
  CreateAgentSession,
  CreateTeamRun,
  DiagnosticsBundle,
  EngineOps,
  ListedModel,
  ProviderTransport,
  TeamRunPort,
} from "@/ai-system/core/types";
import type { WorkspaceChangesPort } from "@/ai-system/core/workspaceChanges";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import { randomUUID } from "@/utils/randomUUID";
import type { AvatarHost } from "./avatarHost";
import { createDiagnosticsHost } from "./diagnosticsHost";
import { createModelDiscoveryHost } from "./modelDiscoveryHost";
import type { ProjectContextHost } from "./projectContextHost";
import { createRunHost } from "./runHost";
import type { SkillHost } from "./skillHost";
import { createThreadHost } from "./threadHost";
import type { ThreadRepository } from "./threadRepository";
import type { ToolArtifactRepository } from "./toolArtifactRepository";
import type { WorkerHost } from "./workerHost";

export interface AIBrokerDeps<TEvent = unknown> {
  keyStore: AIKeyStore;
  getAISettings: () => Promise<AISettings> | AISettings;
  onInvoke: <TChannel extends AIInvokeChannel>(
    channel: TChannel,
    handler: (event: TEvent, payload: unknown) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
  ) => void;
  send: <TChannel extends AIPushChannel>(event: TEvent, channel: TChannel, payload: AIPushPayload<TChannel>) => void;
  senderId: (event: TEvent) => number | string;
  isAllowedSender: (event: TEvent) => boolean;
  providerTransport: ProviderTransport;
  listModels: (
    provider: ResolvedProvider,
    options: { fetchImpl: typeof fetch; signal?: AbortSignal },
  ) => Promise<ListedModel[]>;
  buildAgentPrompt: (bundle?: DiagnosticsBundle) => string;
  buildProjectContextPrompt?: (pack: ProjectContextPack) => string;
  projectContextHost?: ProjectContextHost;
  createAgentSession?: CreateAgentSession;
  compactThreadContext?: CompactThreadContext;
  createTeamRun?: CreateTeamRun;
  runSandboxed?: SandboxRunner;
  engineOps?: EngineOps;
  workspaceAccess?: IWorkspaceAccess;
  workspaceChanges?: WorkspaceChangesPort;
  createExecutionSelector?: ExecutionSelectorFactory;
  permissionsStore?: PermissionsStoreLike;
  knowledgeBank?: KnowledgeBankLike;
  webSearcher?: (query: string) => Promise<{ text: string }>;
  threadRepository: ThreadRepository;
  toolArtifactRepository?: ToolArtifactRepository;
  // The workers library. Absent ⇒ the channels reject and team runs ignore any requested roster.
  workerHost?: WorkerHost;
  // The avatar library. Absent ⇒ the avatar channels reject loudly (never a silent empty list).
  avatarHost?: AvatarHost;
  skillHost?: SkillHost;
  buildSkillInvocationPrompt?: (context: {
    command: string;
    source: string;
    fingerprint: string;
    arguments: string;
    body: string;
  }) => string;
  // CONTAINER_DESKTOP_MOCK only — runs the host starts life already holding, so the Runs list has
  // content in every phase without the user starting one first.
  seedRuns?: TeamRunPort[];
  logger?: { error: (...args: unknown[]) => void };
}

function requirePermissions(store: PermissionsStoreLike | undefined): PermissionsStoreLike {
  if (!store) throw new Error("AI: the permission store is not available");
  return store;
}

export interface AIBroker {
  register(): void;
  disposeForSender(senderId: number | string): void;
  dispose(): void;
}

export function createAIBroker<TEvent = unknown>(deps: AIBrokerDeps<TEvent>): AIBroker {
  const recentErrors: AIRecordedError[] = [];
  const resolveProviderAccess = async (providerId?: string): Promise<ResolvedProvider> => {
    const resolved = resolveProvider(await deps.getAISettings(), providerId);
    if (resolved.requiresKey && !(await deps.keyStore.hasKey(resolved.id))) {
      throw new Error("AI: no credential stored for this provider");
    }
    return resolved;
  };
  const reportError = (message: string, id: string | undefined, error: unknown): void => {
    const detail = redactText(describeError(error)).slice(0, 384);
    recentErrors.push({
      at: Date.now(),
      message: `${message}: ${detail}`.slice(0, 512),
      ...(id ? { context: id.slice(0, 256) } : {}),
    });
    if (recentErrors.length > 20) recentErrors.splice(0, recentErrors.length - 20);
    try {
      deps.logger?.error(message, {
        ...(id ? { threadId: id } : {}),
        error: detail,
      });
    } catch {
      // Teardown is best-effort; logger failure must not become another host failure.
    }
  };

  const threadHost = createThreadHost<TEvent>({
    senderId: deps.senderId,
    send: deps.send,
    getAISettings: deps.getAISettings,
    resolveProviderAccess,
    providerTransport: deps.providerTransport,
    buildAgentPrompt: deps.buildAgentPrompt,
    buildProjectContextPrompt: deps.buildProjectContextPrompt,
    projectContextHost: deps.projectContextHost,
    createAgentSession: deps.createAgentSession,
    compactThreadContext: deps.compactThreadContext,
    runSandboxed: deps.runSandboxed,
    engineOps: deps.engineOps,
    workspaceAccess: deps.workspaceAccess,
    workspaceChanges: deps.workspaceChanges,
    permissionsStore: deps.permissionsStore,
    knowledgeBank: deps.knowledgeBank,
    webSearcher: deps.webSearcher,
    threadRepository: deps.threadRepository,
    storeToolArtifact: deps.toolArtifactRepository
      ? async (input) =>
          toolArtifactReference(
            await deps.toolArtifactRepository!.put(
              createToolArtifactRecord({
                id: randomUUID(),
                threadId: input.threadId,
                createdAt: Date.now(),
                content: input.content,
                byteLength: input.byteLength,
                fingerprint: await sha256Text(input.content),
              }),
            ),
          )
      : undefined,
    deleteToolArtifacts: deps.toolArtifactRepository
      ? (threadId) => deps.toolArtifactRepository!.deleteForThread(threadId)
      : undefined,
    reportError,
    logger: deps.logger,
  });
  const requireProjectContext = (): ProjectContextHost => {
    if (!deps.projectContextHost) throw new Error("AI: project context is unavailable");
    return deps.projectContextHost;
  };
  const runHost = createRunHost<TEvent>({
    senderId: deps.senderId,
    send: deps.send,
    getAISettings: deps.getAISettings,
    resolveProviderAccess,
    providerTransport: deps.providerTransport,
    buildAgentPrompt: deps.buildAgentPrompt,
    createTeamRun: deps.createTeamRun,
    workerHost: deps.workerHost,
    seedRuns: deps.seedRuns,
    runSandboxed: deps.runSandboxed,
    engineOps: deps.engineOps,
    workspaceAccess: deps.workspaceAccess,
    createExecutionSelector: deps.createExecutionSelector,
    permissionsStore: deps.permissionsStore,
    knowledgeBank: deps.knowledgeBank,
    webSearcher: deps.webSearcher,
    reportError,
    logger: deps.logger,
  });
  const models = createModelDiscoveryHost<TEvent>({
    senderId: deps.senderId,
    resolveProviderAccess,
    providerTransport: deps.providerTransport,
    listModels: deps.listModels,
  });

  const status = (): AIStatus => ({
    encryption: deps.keyStore.getEncryptionStatus(),
    webSearchAvailable: !!deps.webSearcher,
  });
  const diagnostics = createDiagnosticsHost({
    keyStore: deps.keyStore,
    getAISettings: deps.getAISettings,
    providerTransport: deps.providerTransport,
    listModels: deps.listModels,
    permissionsStore: deps.permissionsStore,
    skillHost: deps.skillHost,
    webSearchAvailable: !!deps.webSearcher,
    capabilities: {
      agentSessions: !!deps.createAgentSession,
      teamRuns: !!deps.createTeamRun,
      sandbox: !!deps.runSandboxed,
      containerTools: !!deps.engineOps,
      workspaceTools: !!deps.workspaceAccess,
      executionTargets: !!deps.createExecutionSelector,
    },
    recentErrors: () => recentErrors,
  });
  const guarded = async <T>(event: TEvent, task: () => T | Promise<T>): Promise<T> => {
    if (!deps.isAllowedSender(event)) throw new Error("AI: unauthorized sender");
    return task();
  };
  // A shell that offers no workers library must fail the channel loudly. Answering with an empty list would look
  // to the editor like "you have no workers", and its next save would appear to succeed while persisting nothing.
  const requireWorkers = (): WorkerHost => {
    if (!deps.workerHost) throw new Error("AI: the workers library is unavailable on this runtime");
    return deps.workerHost;
  };
  const requireAvatars = (): AvatarHost => {
    if (!deps.avatarHost) throw new Error("AI: the avatar library is unavailable on this runtime");
    return deps.avatarHost;
  };
  const requireSkills = (): SkillHost => {
    if (!deps.skillHost) throw new Error("AI: the skills library is unavailable on this runtime");
    return deps.skillHost;
  };
  const skillObservers = new Map<number | string, TEvent>();
  const observeSkills = (event: TEvent): void => {
    skillObservers.set(deps.senderId(event), event);
  };
  const unsubscribeSkills = deps.skillHost?.subscribe((snapshot) => {
    for (const [senderId, event] of skillObservers) {
      try {
        deps.send(event, AI_CHANNELS.skillsChanged, snapshot);
      } catch (error) {
        skillObservers.delete(senderId);
        reportError("AI: skill observer delivery failed", undefined, error);
      }
    }
  });

  const register = (): void => {
    const onInvoke = <TChannel extends AIInvokeChannel>(
      channel: TChannel,
      handler: (
        event: TEvent,
        payload: AIInvokeRequest<TChannel>,
      ) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
    ) => deps.onInvoke(channel, async (event, payload) => handler(event, validateAIInvokeRequest(channel, payload)));

    onInvoke(AI_CHANNELS.status, (event) => guarded(event, () => status()));
    onInvoke(AI_CHANNELS.diagnostics, (event, request) => guarded(event, () => diagnostics(request.providerId)));
    onInvoke(AI_CHANNELS.keyHas, (event, request) => guarded(event, () => deps.keyStore.hasKey(request.provider)));
    onInvoke(AI_CHANNELS.keySet, (event, request) =>
      guarded(event, async () => {
        await deps.keyStore.setKey(request.provider, request.key, { allowDegraded: !!request.allowDegraded });
        return { ok: true };
      }),
    );
    onInvoke(AI_CHANNELS.keyClear, (event, request) =>
      guarded(event, async () => {
        await deps.keyStore.clearKey(request.provider);
        return { ok: true };
      }),
    );
    onInvoke(AI_CHANNELS.threadList, (event) => guarded(event, () => threadHost.list()));
    onInvoke(AI_CHANNELS.threadCreate, (event, request) => guarded(event, () => threadHost.create(request)));
    onInvoke(AI_CHANNELS.threadRename, (event, request) =>
      guarded(event, () => threadHost.rename(request.threadId, request.title)),
    );
    onInvoke(AI_CHANNELS.threadConfigure, (event, request) =>
      guarded(event, () =>
        threadHost.configure(request.threadId, {
          accessProfile: request.accessProfile,
          reasoningLevel: request.reasoningLevel,
        }),
      ),
    );
    onInvoke(AI_CHANNELS.threadBranchPreview, (event, request) =>
      guarded(event, () => threadHost.branchPreview(request.threadId)),
    );
    onInvoke(AI_CHANNELS.threadBranch, (event, request) =>
      guarded(event, () => threadHost.branch(request.threadId, request.checkpointId, request.title)),
    );
    onInvoke(AI_CHANNELS.threadCompactionPreview, (event, request) =>
      guarded(event, () => threadHost.compactionPreview(request.threadId)),
    );
    onInvoke(AI_CHANNELS.threadCompact, (event, request) =>
      guarded(event, () => threadHost.compact(request.threadId, request.revision, request.instructions)),
    );
    onInvoke(AI_CHANNELS.threadSubmit, (event, request) => guarded(event, () => threadHost.submit(event, request)));
    onInvoke(AI_CHANNELS.threadResolveApproval, (event, request) =>
      guarded(event, () => threadHost.resolve(event, request)),
    );
    onInvoke(AI_CHANNELS.threadStop, (event, request) =>
      guarded(event, () => threadHost.cancel(event, request.threadId)),
    );
    onInvoke(AI_CHANNELS.threadSnapshot, (event, request) =>
      guarded(event, () => threadHost.snapshot(event, request.threadId)),
    );
    onInvoke(AI_CHANNELS.toolArtifactGet, (event, request) =>
      guarded(event, async () => {
        const artifact = await deps.toolArtifactRepository?.get(request.threadId, request.artifactId);
        if (!artifact) throw new Error("AI: tool artifact not found");
        return artifact;
      }),
    );
    onInvoke(AI_CHANNELS.threadDelete, (event, request) => guarded(event, () => threadHost.delete(request.threadId)));
    onInvoke(AI_CHANNELS.changesStatus, (event) =>
      guarded(event, () => {
        if (!deps.workspaceChanges) throw new Error("AI: workspace change review is unavailable");
        return deps.workspaceChanges.status();
      }),
    );
    onInvoke(AI_CHANNELS.changesDiff, (event) =>
      guarded(event, () => {
        if (!deps.workspaceChanges) throw new Error("AI: workspace change review is unavailable");
        return deps.workspaceChanges.diff();
      }),
    );
    onInvoke(AI_CHANNELS.projectContextSnapshot, (event) =>
      guarded(event, () =>
        deps.projectContextHost
          ? deps.projectContextHost.snapshot()
          : { state: "unconfigured", rules: [], memory: [], message: "AI: project context is unavailable" },
      ),
    );
    onInvoke(AI_CHANNELS.projectRulesSetEnabled, (event, request) =>
      guarded(event, () => requireProjectContext().setRulesEnabled(request.enabled)),
    );
    onInvoke(AI_CHANNELS.projectRulesInitialize, (event) =>
      guarded(event, () => requireProjectContext().initializeRules()),
    );
    onInvoke(AI_CHANNELS.projectMemoryAdd, (event, request) =>
      guarded(event, () => requireProjectContext().addMemory(request.content)),
    );
    onInvoke(AI_CHANNELS.projectMemoryRemove, (event, request) =>
      guarded(event, () => requireProjectContext().removeMemory(request.id)),
    );
    onInvoke(AI_CHANNELS.projectMemoryClear, (event) => guarded(event, () => requireProjectContext().clearMemory()));
    onInvoke(AI_CHANNELS.projectMemoryImport, (event, content) =>
      guarded(event, () => requireProjectContext().importMemory(content)),
    );
    onInvoke(AI_CHANNELS.runStart, (event, request) => guarded(event, () => runHost.start(event, request)));
    onInvoke(AI_CHANNELS.runApprovePlan, (event, request) => guarded(event, () => runHost.resolvePlan(event, request)));
    onInvoke(AI_CHANNELS.runApproveTool, (event, request) => guarded(event, () => runHost.resolveTool(event, request)));
    onInvoke(AI_CHANNELS.runCancel, (event, request) => guarded(event, () => runHost.cancel(event, request.runId)));
    onInvoke(AI_CHANNELS.runSnapshot, (event, request) => guarded(event, () => runHost.snapshot(event, request.runId)));
    onInvoke(AI_CHANNELS.runList, (event) => guarded(event, () => ({ runs: runHost.list(event) })));
    onInvoke(AI_CHANNELS.workersList, (event) => guarded(event, () => ({ workers: requireWorkers().list() })));
    onInvoke(AI_CHANNELS.workersSave, (event, request) =>
      guarded(event, async () => ({ workers: await requireWorkers().save(request.worker) })),
    );
    onInvoke(AI_CHANNELS.workersRemove, (event, request) =>
      guarded(event, async () => ({ workers: await requireWorkers().remove(request.id) })),
    );
    onInvoke(AI_CHANNELS.avatarsList, (event) => guarded(event, () => ({ avatars: requireAvatars().list() })));
    onInvoke(AI_CHANNELS.avatarsSave, (event, request) =>
      guarded(event, async () => ({ avatars: await requireAvatars().save(request.avatar) })),
    );
    onInvoke(AI_CHANNELS.avatarsRemove, (event, request) =>
      guarded(event, async () => ({ avatars: await requireAvatars().remove(request.id) })),
    );
    onInvoke(AI_CHANNELS.modelsList, (event, request) =>
      guarded(event, () => models.list(event, request.requestId, request.providerId)),
    );
    onInvoke(AI_CHANNELS.modelsCancel, (event, request) =>
      guarded(event, () => models.cancel(event, request.requestId)),
    );
    onInvoke(AI_CHANNELS.permissionsList, (event) =>
      guarded(event, () => requirePermissions(deps.permissionsStore).load()),
    );
    onInvoke(AI_CHANNELS.permissionsRemove, (event, request) =>
      guarded(event, () => requirePermissions(deps.permissionsStore).removeCommand(request.list, request.key)),
    );
    onInvoke(AI_CHANNELS.skillsSnapshot, (event) =>
      guarded(event, () => {
        observeSkills(event);
        return requireSkills().snapshot();
      }),
    );
    onInvoke(AI_CHANNELS.skillsReload, (event) =>
      guarded(event, () => {
        observeSkills(event);
        return requireSkills().reload();
      }),
    );
    onInvoke(AI_CHANNELS.skillsSetProjectSource, (event, request) =>
      guarded(event, () => {
        observeSkills(event);
        return requireSkills().setProjectSourceEnabled(request.enabled);
      }),
    );
    onInvoke(AI_CHANNELS.skillsSetProjectTrust, (event, request) =>
      guarded(event, () => {
        observeSkills(event);
        return requireSkills().setProjectSkillTrust(request.skillId, request.expectedFingerprint, request.trusted);
      }),
    );
    onInvoke(AI_CHANNELS.skillsInvoke, (event, request) =>
      guarded(event, async () => {
        observeSkills(event);
        const resolved = await requireSkills().resolveInvocation(request);
        if (!deps.buildSkillInvocationPrompt) throw new Error("AI: skill prompt builder is unavailable");
        const prompt = deps.buildSkillInvocationPrompt({
          command: resolved.descriptor.command,
          source: resolved.descriptor.source.kind,
          fingerprint: resolved.descriptor.fingerprint,
          arguments: resolved.arguments,
          body: resolved.manifest.body,
        });
        if (new TextEncoder().encode(prompt).byteLength > SKILL_LIMITS.renderedPromptBytes) {
          throw new Error("AI: rendered skill prompt is too large");
        }
        const createdAt = Date.now();
        const id = randomUUID();
        const displayContent = `${resolved.descriptor.command}${resolved.arguments ? ` ${resolved.arguments}` : ""}`;
        return threadHost.submit(
          event,
          { threadId: request.threadId, message: { id, content: displayContent, createdAt }, history: [] },
          {
            message: {
              id,
              content: prompt,
              displayContent,
              createdAt,
              skill: {
                skillId: resolved.descriptor.id,
                command: resolved.descriptor.command,
                source: resolved.descriptor.source.kind,
                fingerprint: resolved.descriptor.fingerprint,
              },
            },
            ...(resolved.manifest.allowedTools ? { allowedTools: new Set(resolved.manifest.allowedTools) } : {}),
            ...(resolved.initialTaint ? { initialTaint: true } : {}),
            contextSources: [
              {
                kind: "skill",
                trust: resolved.descriptor.source.kind === "bundled" ? "application" : resolved.descriptor.source.kind,
                characters: prompt.length,
              },
            ],
          },
        );
      }),
    );
  };

  return {
    register,
    disposeForSender(senderId: number | string): void {
      threadHost.disposeForSender(senderId);
      runHost.disposeForSender(senderId);
      models.disposeForSender(senderId);
      skillObservers.delete(senderId);
    },
    dispose(): void {
      threadHost.dispose();
      runHost.dispose();
      models.dispose();
      unsubscribeSkills?.();
      deps.skillHost?.dispose();
      skillObservers.clear();
      try {
        deps.providerTransport.dispose();
      } catch (error) {
        reportError("AI: provider fetch disposal failed", undefined, error);
      }
    },
  };
}
