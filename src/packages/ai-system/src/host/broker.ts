import {
  AI_CHANNELS,
  type AIInvokeChannel,
  type AIInvokeRequest,
  type AIInvokeResponse,
  type AIPushChannel,
  type AIPushPayload,
  type AIStatus,
} from "@/ai-system/core/channels";
import type { PermissionsStoreLike } from "@/ai-system/core/permissions";
import type { AIKeyStore, KnowledgeBankLike, SandboxRunner } from "@/ai-system/core/ports";
import { type ResolvedProvider, resolveProvider } from "@/ai-system/core/providers";
import { redactText } from "@/ai-system/core/redact";
import { validateAIInvokeRequest } from "@/ai-system/core/schemas";
import type {
  AISettings,
  CreateAgentSession,
  CreateGoalRun,
  DiagnosticsBundle,
  EngineOps,
  GoalRunPort,
  ListedModel,
  ProviderTransport,
} from "@/ai-system/core/types";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import { createChatHost } from "./chatHost";
import type { ConversationRepository } from "./conversationRepository";
import { createGoalHost } from "./goalHost";
import { createModelDiscoveryHost } from "./modelDiscoveryHost";
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
  createAgentSession?: CreateAgentSession;
  createGoalRun?: CreateGoalRun;
  runSandboxed?: SandboxRunner;
  engineOps?: EngineOps;
  workspaceAccess?: IWorkspaceAccess;
  permissionsStore?: PermissionsStoreLike;
  knowledgeBank?: KnowledgeBankLike;
  webSearcher?: (query: string) => Promise<{ text: string }>;
  conversationRepository: ConversationRepository;
  // The workers library. Absent ⇒ the channels reject and goal runs ignore any requested roster.
  workerHost?: WorkerHost;
  // CONTAINER_DESKTOP_MOCK only — goal runs the host starts life already holding, so the Goals list has
  // content in every phase without the user starting one first.
  seedRuns?: GoalRunPort[];
  logger?: { error: (...args: unknown[]) => void };
}

function requirePermissions(store: PermissionsStoreLike | undefined): PermissionsStoreLike {
  if (!store) throw new Error("AI: the permission store is not available");
  return store;
}

// biome-ignore lint/correctness/noUnusedVariables: TEvent parameterizes the broker at the shell call sites (AIBroker<TEvent>); the returned handle's surface is event-agnostic.
export interface AIBroker<TEvent = unknown> {
  register(): void;
  disposeForSender(senderId: number | string): void;
  dispose(): void;
}

export function createAIBroker<TEvent = unknown>(deps: AIBrokerDeps<TEvent>): AIBroker<TEvent> {
  const resolveProviderAccess = async (providerId?: string): Promise<ResolvedProvider> => {
    const resolved = resolveProvider(await deps.getAISettings(), providerId);
    if (resolved.requiresKey && !(await deps.keyStore.hasKey(resolved.id))) {
      throw new Error("AI: no credential stored for this provider");
    }
    return resolved;
  };
  const reportError = (message: string, id: string | undefined, error: unknown): void => {
    try {
      deps.logger?.error(message, {
        ...(id ? { sessionId: id } : {}),
        error: redactText(error instanceof Error ? error.message : String(error)).slice(0, 512),
      });
    } catch {
      // Teardown is best-effort; logger failure must not become another host failure.
    }
  };

  const chat = createChatHost<TEvent>({
    senderId: deps.senderId,
    send: deps.send,
    getAISettings: deps.getAISettings,
    resolveProviderAccess,
    providerTransport: deps.providerTransport,
    buildAgentPrompt: deps.buildAgentPrompt,
    createAgentSession: deps.createAgentSession,
    runSandboxed: deps.runSandboxed,
    engineOps: deps.engineOps,
    workspaceAccess: deps.workspaceAccess,
    permissionsStore: deps.permissionsStore,
    knowledgeBank: deps.knowledgeBank,
    webSearcher: deps.webSearcher,
    conversationRepository: deps.conversationRepository,
    reportError,
    logger: deps.logger,
  });
  const goals = createGoalHost<TEvent>({
    senderId: deps.senderId,
    send: deps.send,
    getAISettings: deps.getAISettings,
    resolveProviderAccess,
    providerTransport: deps.providerTransport,
    buildAgentPrompt: deps.buildAgentPrompt,
    createGoalRun: deps.createGoalRun,
    workerHost: deps.workerHost,
    seedRuns: deps.seedRuns,
    runSandboxed: deps.runSandboxed,
    engineOps: deps.engineOps,
    workspaceAccess: deps.workspaceAccess,
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

  const register = (): void => {
    const onInvoke = <TChannel extends AIInvokeChannel>(
      channel: TChannel,
      handler: (
        event: TEvent,
        payload: AIInvokeRequest<TChannel>,
      ) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
    ) => deps.onInvoke(channel, async (event, payload) => handler(event, validateAIInvokeRequest(channel, payload)));

    onInvoke(AI_CHANNELS.status, (event) => guarded(event, () => status()));
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
    onInvoke(AI_CHANNELS.chatList, (event) => guarded(event, () => chat.list()));
    onInvoke(AI_CHANNELS.chatCreate, (event, request) => guarded(event, () => chat.create(request)));
    onInvoke(AI_CHANNELS.chatSubmit, (event, request) => guarded(event, () => chat.submit(event, request)));
    onInvoke(AI_CHANNELS.chatResolve, (event, request) => guarded(event, () => chat.resolve(event, request)));
    onInvoke(AI_CHANNELS.chatCancel, (event, request) => guarded(event, () => chat.cancel(event, request.sessionId)));
    onInvoke(AI_CHANNELS.chatSnapshot, (event, request) =>
      guarded(event, () => chat.snapshot(event, request.sessionId)),
    );
    onInvoke(AI_CHANNELS.chatDispose, (event, request) => guarded(event, () => chat.delete(request.sessionId)));
    onInvoke(AI_CHANNELS.goalStart, (event, request) => guarded(event, () => goals.start(event, request)));
    onInvoke(AI_CHANNELS.goalApprovePlan, (event, request) => guarded(event, () => goals.resolvePlan(event, request)));
    onInvoke(AI_CHANNELS.goalApproveTool, (event, request) => guarded(event, () => goals.resolveTool(event, request)));
    onInvoke(AI_CHANNELS.goalCancel, (event, request) => guarded(event, () => goals.cancel(event, request.runId)));
    onInvoke(AI_CHANNELS.goalSnapshot, (event, request) => guarded(event, () => goals.snapshot(event, request.runId)));
    onInvoke(AI_CHANNELS.goalList, (event) => guarded(event, () => ({ runs: goals.list(event) })));
    onInvoke(AI_CHANNELS.workersList, (event) => guarded(event, () => ({ workers: requireWorkers().list() })));
    onInvoke(AI_CHANNELS.workersSave, (event, request) =>
      guarded(event, async () => ({ workers: await requireWorkers().save(request.worker) })),
    );
    onInvoke(AI_CHANNELS.workersRemove, (event, request) =>
      guarded(event, async () => ({ workers: await requireWorkers().remove(request.id) })),
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
    onInvoke(AI_CHANNELS.permissionsSetWeb, (event, request) =>
      guarded(event, () => requirePermissions(deps.permissionsStore).setWebSearch(request.verdict ?? undefined)),
    );
  };

  return {
    register,
    disposeForSender(senderId: number | string): void {
      chat.disposeForSender(senderId);
      goals.disposeForSender(senderId);
      models.disposeForSender(senderId);
    },
    dispose(): void {
      chat.dispose();
      goals.dispose();
      models.dispose();
      try {
        deps.providerTransport.dispose();
      } catch (error) {
        reportError("AI: provider fetch disposal failed", undefined, error);
      }
    },
  };
}
