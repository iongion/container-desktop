import { createProviderFetch } from "@/ai-system/adapters/providerFetch";
import { sha256Text } from "@/ai-system/adapters/sha256";
import { type AccessProfileId, accessProfileTools, DEFAULT_ACCESS_PROFILE } from "@/ai-system/core/accessProfiles";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import type { EffectiveContextSource } from "@/ai-system/core/context";
import {
  MAX_ACTIVE_AGENT_SESSIONS,
  MAX_DIAGNOSTICS_BUNDLE_CHARS,
  MAX_THREAD_MODEL_MESSAGES,
  MAX_THREAD_TIMELINE_ITEMS,
} from "@/ai-system/core/limits";
import type { PermissionsStoreLike } from "@/ai-system/core/permissions";
import type { AgentExecutionDeps, KnowledgeBankLike, SandboxRunner } from "@/ai-system/core/ports";
import type { ProjectContextPack } from "@/ai-system/core/projectContext";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { type ReasoningLevel, reasoningCapability, reasoningThinking } from "@/ai-system/core/reasoning";
import { redactPayload, redactText } from "@/ai-system/core/redact";
import {
  planThreadCompaction,
  THREAD_COMPACTION_MINIMUM_SOURCE_MESSAGES,
  THREAD_COMPACTION_RETAIN_RECENT_MESSAGES,
  type ThreadCompactionExecutionResult,
  type ThreadCompactionPreview,
  type ThreadCompactionRevision,
} from "@/ai-system/core/threadCompaction";
import {
  MAX_INITIAL_THREAD_HISTORY_CHARS,
  type ResolveThreadApprovalRequest,
  type ResolveThreadApprovalResult,
  type SubmitThreadRequest,
  type SubmitThreadResult,
  type ThreadEventEnvelope,
  type ThreadTimelineItem,
  type ThreadView,
} from "@/ai-system/core/threadEvents";
import { viewFromMessages } from "@/ai-system/core/threadReducer";
import {
  appendThreadCheckpoint,
  type CreateThreadRequest,
  createEmptyThreadRecord,
  type ThreadBranchPreview,
  type ThreadBranchResult,
  type ThreadConfigurationPatch,
  type ThreadRecord,
  type ThreadSummary,
  threadSummary,
} from "@/ai-system/core/threads";
import type { ToolArtifactReference } from "@/ai-system/core/toolArtifacts";
import type {
  AgentSessionInputMessage,
  AISettings,
  CompactThreadContext,
  CreateAgentSession,
  DiagnosticsBundle,
  EngineOps,
  ProviderTransport,
  ThreadMessage,
} from "@/ai-system/core/types";
import type { WorkspaceChangesPort } from "@/ai-system/core/workspaceChanges";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import { randomUUID } from "@/utils/randomUUID";
import type { ThreadRepository } from "./threadRepository";

const DIAGNOSTICS_FIELDS = ["os", "engine", "connection", "screen", "activity", "resources", "errors"] as const;

interface AgentSessionRecord<TEvent> {
  threadId: string;
  agentSession: ReturnType<CreateAgentSession>;
  observers: Map<number | string, TEvent>;
  providerId?: string;
  model?: string;
  accessProfile: AccessProfileId;
  reasoningLevel: ReasoningLevel;
  deleted: boolean;
}

export interface ThreadHostDeps<TEvent> {
  senderId: (event: TEvent) => number | string;
  send: (event: TEvent, channel: typeof AI_CHANNELS.threadEvent, payload: ThreadEventEnvelope) => void;
  getAISettings: () => Promise<AISettings> | AISettings;
  resolveProviderAccess: (providerId?: string) => Promise<ResolvedProvider>;
  providerTransport: ProviderTransport;
  buildAgentPrompt: (bundle?: DiagnosticsBundle) => string;
  buildProjectContextPrompt?: (pack: ProjectContextPack) => string;
  projectContextHost?: { capture(): Promise<ProjectContextPack | undefined> };
  createAgentSession?: CreateAgentSession;
  compactThreadContext?: CompactThreadContext;
  runSandboxed?: SandboxRunner;
  engineOps?: EngineOps;
  workspaceAccess?: IWorkspaceAccess;
  workspaceChanges?: WorkspaceChangesPort;
  permissionsStore?: PermissionsStoreLike;
  knowledgeBank?: KnowledgeBankLike;
  webSearcher?: (query: string) => Promise<{ text: string }>;
  threadRepository: ThreadRepository;
  storeToolArtifact?: (input: {
    threadId: string;
    toolCallId: string;
    tool: string;
    content: string;
    byteLength: number;
  }) => Promise<ToolArtifactReference>;
  deleteToolArtifacts?: (threadId: string) => Promise<unknown>;
  reportError: (message: string, id: string | undefined, error: unknown) => void;
  logger?: { error: (...args: unknown[]) => void };
}

interface ThreadSubmitOptions {
  message: AgentSessionInputMessage;
  allowedTools?: ReadonlySet<string>;
  initialTaint?: boolean;
  contextSources?: readonly EffectiveContextSource[];
}

function intersectTools(primary: ReadonlySet<string>, secondary?: ReadonlySet<string>): ReadonlySet<string> {
  return secondary ? new Set([...primary].filter((tool) => secondary.has(tool))) : primary;
}

function contextSourcesForBundle(bundle: DiagnosticsBundle | undefined): EffectiveContextSource[] {
  if (!bundle) return [];
  return DIAGNOSTICS_FIELDS.flatMap((kind) => {
    const value = bundle[kind];
    return value === undefined ? [] : [{ kind, trust: "external" as const, characters: value.length }];
  });
}

function sanitizeMessage(value: SubmitThreadRequest["history"][number]): SubmitThreadRequest["history"][number] {
  return { ...value, content: redactText(value.content) };
}

function sanitizeBundle(value: DiagnosticsBundle | undefined): DiagnosticsBundle | undefined {
  if (!value) return undefined;
  const bundle: DiagnosticsBundle = {};
  let total = 0;
  for (const field of DIAGNOSTICS_FIELDS) {
    const entry = value[field];
    if (entry === undefined) continue;
    total += entry.length;
    if (total > MAX_DIAGNOSTICS_BUNDLE_CHARS) throw new Error("AI: diagnostics bundle is too large");
    bundle[field] = entry;
  }
  return bundle;
}

function sanitizeSubmit(request: SubmitThreadRequest): SubmitThreadRequest {
  const content = request.message.content.trim();
  const history = request.history.map(sanitizeMessage);
  if (history.reduce((total, entry) => total + entry.content.length, 0) > MAX_INITIAL_THREAD_HISTORY_CHARS) {
    throw new Error("AI: initial Thread history is too large");
  }
  return {
    ...request,
    message: { ...request.message, content: redactText(content) },
    history,
    bundle: sanitizeBundle(request.bundle),
  };
}

function messagesFromThread(record: ThreadRecord): ThreadMessage[] {
  return record.view.timeline.flatMap((item, index) =>
    item.kind === "message" && item.delivery === "applied"
      ? [
          {
            id: item.id,
            role: item.role,
            content: item.content,
            createdAt: index,
            ...(item.skill ? { skill: item.skill } : {}),
          },
        ]
      : [],
  );
}

const isDurableEvent = (envelope: ThreadEventEnvelope): boolean =>
  envelope.event.type !== "assistant-start" && envelope.event.type !== "assistant-delta";

const isAppliedUserMessage = (item: ThreadTimelineItem): boolean =>
  item.kind === "message" && item.role === "user" && item.delivery === "applied";

export function createThreadHost<TEvent>(deps: ThreadHostDeps<TEvent>) {
  const agentSessions = new Map<string, AgentSessionRecord<TEvent>>();
  const compactingThreads = new Set<string>();
  const configuringThreads = new Set<string>();

  const observe = (record: AgentSessionRecord<TEvent>, event: TEvent): void => {
    record.observers.set(deps.senderId(event), event);
  };

  const find = (event: TEvent, threadId: string): AgentSessionRecord<TEvent> | undefined => {
    const record = agentSessions.get(threadId);
    if (record) observe(record, event);
    return record;
  };

  const requireAgentSession = (event: TEvent, threadId: string): AgentSessionRecord<TEvent> => {
    const record = find(event, threadId);
    if (!record) throw new Error("AI: Thread not found");
    return record;
  };

  const broadcast = (record: AgentSessionRecord<TEvent>, envelope: ThreadEventEnvelope): void => {
    for (const [senderId, event] of record.observers) {
      try {
        deps.send(event, AI_CHANNELS.threadEvent, envelope);
      } catch (error) {
        record.observers.delete(senderId);
        deps.reportError("AI: Thread observer delivery failed", record.threadId, error);
      }
    }
  };

  const isCurrent = (record: AgentSessionRecord<TEvent>): boolean =>
    !record.deleted && agentSessions.get(record.threadId) === record;

  const persist = async (record: AgentSessionRecord<TEvent>): Promise<void> => {
    if (!isCurrent(record)) return;
    const durable = record.agentSession.durableSnapshot();
    const existing = await deps.threadRepository.get(record.threadId);
    if (!existing || !isCurrent(record)) return;
    const firstUser = durable.view.timeline.find(isAppliedUserMessage);
    const previouslyHadUser = existing.view.timeline.some(isAppliedUserMessage);
    const next: ThreadRecord = {
      ...existing,
      title:
        existing.titleOrigin !== "user" && !previouslyHadUser && firstUser?.kind === "message"
          ? firstUser.content.slice(0, 48)
          : existing.title,
      titleOrigin:
        existing.titleOrigin !== "user" && !previouslyHadUser && firstUser?.kind === "message"
          ? "message"
          : existing.titleOrigin,
      updatedAt: Date.now(),
      ...(record.providerId ? { providerId: record.providerId } : {}),
      ...(record.model ? { model: record.model } : {}),
      accessProfile: record.accessProfile,
      reasoningLevel: record.reasoningLevel,
      view: durable.view,
      modelHistory: durable.modelHistory,
    };
    await deps.threadRepository.upsert(
      durable.view.phase === "idle" ? appendThreadCheckpoint(next, { id: randomUUID(), now: Date.now() }) : next,
    );
  };

  const disposeAgentSession = (record: AgentSessionRecord<TEvent>): void => {
    void record.agentSession
      .dispose()
      .catch((error) => deps.reportError("AI: Agent Session disposal failed", record.threadId, error));
  };

  const ensureCapacity = (): void => {
    if (agentSessions.size < MAX_ACTIVE_AGENT_SESSIONS) return;
    for (const [threadId, record] of agentSessions) {
      if (["idle", "error"].includes(record.agentSession.snapshot().phase)) {
        agentSessions.delete(threadId);
        disposeAgentSession(record);
        return;
      }
    }
    throw new Error("AI: too many active Agent Sessions");
  };

  const compactionSource = async (threadId: string) => {
    const live = agentSessions.get(threadId);
    if (live && live.agentSession.snapshot().phase !== "idle") throw new Error("AI: Thread must be idle to compact");
    if (live) await persist(live);
    const source = await deps.threadRepository.get(threadId);
    if (!source) throw new Error("AI: Thread not found");
    const plan = planThreadCompaction(source, {
      retainRecentMessages: THREAD_COMPACTION_RETAIN_RECENT_MESSAGES,
      minimumSourceMessages: THREAD_COMPACTION_MINIMUM_SOURCE_MESSAGES,
    });
    if (!plan) throw new Error("AI: Thread does not have enough settled history to compact");
    const resolved = await deps.resolveProviderAccess(source.providerId);
    if (source.model) resolved.model = source.model;
    return { live, source, plan, resolved };
  };

  return {
    list(): Promise<ThreadSummary[]> {
      return deps.threadRepository.list();
    },
    async create(request: CreateThreadRequest): Promise<ThreadSummary> {
      const existing = await deps.threadRepository.get(request.id);
      if (existing) return threadSummary(existing);
      const created = await deps.threadRepository.create(
        createEmptyThreadRecord({
          ...request,
          title: redactText(request.title),
          now: Date.now(),
          model: request.model?.trim() || undefined,
        }),
      );
      return threadSummary(created);
    },
    async rename(threadId: string, title: string): Promise<ThreadSummary> {
      return threadSummary(await deps.threadRepository.rename(threadId, redactText(title), Date.now()));
    },
    async configure(threadId: string, patch: ThreadConfigurationPatch): Promise<ThreadSummary> {
      if (patch.accessProfile === undefined && patch.reasoningLevel === undefined) {
        throw new Error("AI: Thread configuration is empty");
      }
      if (compactingThreads.has(threadId)) throw new Error("AI: Thread compaction is running");
      const live = agentSessions.get(threadId);
      if (live && !["idle", "error"].includes(live.agentSession.snapshot().phase)) {
        throw new Error("AI: Thread configuration cannot change during an active turn");
      }
      configuringThreads.add(threadId);
      try {
        if (live) await persist(live);
        const source = await deps.threadRepository.get(threadId);
        if (!source) throw new Error("AI: Thread not found");
        if (patch.reasoningLevel !== undefined) {
          const resolved = await deps.resolveProviderAccess(source.providerId);
          if (source.model) resolved.model = source.model;
          if (!reasoningCapability(resolved.id, resolved.model).levels.includes(patch.reasoningLevel)) {
            throw new Error("AI: the selected reasoning level is unavailable for this model");
          }
        }
        const configured = await deps.threadRepository.configure(threadId, patch, Date.now());
        if (live) {
          if (patch.accessProfile !== undefined) live.accessProfile = patch.accessProfile;
          if (patch.reasoningLevel !== undefined) live.reasoningLevel = patch.reasoningLevel;
        }
        return threadSummary(configured);
      } finally {
        configuringThreads.delete(threadId);
      }
    },
    async branchPreview(threadId: string): Promise<ThreadBranchPreview> {
      const live = agentSessions.get(threadId);
      if (live?.agentSession.snapshot().phase === "idle") await persist(live);
      else if (!live) await deps.threadRepository.checkpoint(threadId, { id: randomUUID(), now: Date.now() });
      const source = await deps.threadRepository.get(threadId);
      if (!source) throw new Error("AI: Thread not found");
      const settings = await deps.getAISettings();
      return {
        source: threadSummary(source),
        checkpoints: structuredClone(source.checkpoints),
        bindings: {
          ...(source.providerId ? { providerId: source.providerId } : {}),
          ...(source.model ? { model: source.model } : {}),
          ...(settings.workspaceRoot ? { workspaceRoot: settings.workspaceRoot } : {}),
          permissionMode: settings.permissionMode ?? "ask",
          contextPolicy: "application",
          target: "host",
        },
        environmentRestored: false,
      };
    },
    async branch(threadId: string, checkpointId: string, title: string): Promise<ThreadBranchResult> {
      const live = agentSessions.get(threadId);
      if (live?.agentSession.snapshot().phase === "idle") await persist(live);
      const created = await deps.threadRepository.branch(threadId, {
        id: randomUUID(),
        checkpointId: randomUUID(),
        parentCheckpointId: checkpointId,
        title: redactText(title),
        now: Date.now(),
        nextId: randomUUID,
      });
      return { thread: threadSummary(created), view: structuredClone(created.view) };
    },
    async compactionPreview(threadId: string): Promise<ThreadCompactionPreview> {
      const { source, plan, resolved } = await compactionSource(threadId);
      const active = source.compactions.find(({ id }) => id === source.activeCompactionId);
      return {
        thread: threadSummary(source),
        plan,
        providerId: resolved.id,
        ...(resolved.model ? { model: resolved.model } : {}),
        ...(active ? { active: structuredClone(active) } : {}),
      };
    },
    async compact(
      threadId: string,
      revision: ThreadCompactionRevision,
      instructions?: string,
    ): Promise<ThreadCompactionExecutionResult> {
      if (!deps.compactThreadContext) throw new Error("AI: Thread compaction is unavailable");
      if (compactingThreads.has(threadId)) throw new Error("AI: Thread compaction is already running");
      compactingThreads.add(threadId);
      try {
        const { live, source, plan, resolved } = await compactionSource(threadId);
        if (JSON.stringify(plan.revision) !== JSON.stringify(revision)) {
          throw new Error("AI: Thread changed after compaction preview");
        }
        const generated = await deps.compactThreadContext({
          resolved,
          providerFetch: createProviderFetch(deps.providerTransport, resolved),
          modelHistory: source.modelHistory,
          source: plan.source,
          ...(instructions?.trim() ? { instructions: redactText(instructions.trim()) } : {}),
        });
        const id = randomUUID();
        const compacted = await deps.threadRepository.compact(threadId, {
          id,
          createdAt: Date.now(),
          plan,
          ...generated,
          fingerprint: await sha256Text(generated.summary),
          ...(instructions?.trim() ? { instructions: redactText(instructions.trim()) } : {}),
        });
        const compaction = compacted.compactions.find((candidate) => candidate.id === id);
        if (!compaction) throw new Error("AI: Thread compaction was not retained");
        if (live && agentSessions.get(threadId) === live) {
          agentSessions.delete(threadId);
          disposeAgentSession(live);
        }
        return { thread: threadSummary(compacted), view: structuredClone(compacted.view), compaction };
      } finally {
        compactingThreads.delete(threadId);
      }
    },
    async submit(
      event: TEvent,
      input: SubmitThreadRequest,
      options?: ThreadSubmitOptions,
    ): Promise<SubmitThreadResult> {
      const { createAgentSession, runSandboxed, knowledgeBank } = deps;
      if (!createAgentSession || !runSandboxed || !knowledgeBank) throw new Error("AI: the assistant is not available");
      if (compactingThreads.has(input.threadId)) throw new Error("AI: Thread compaction is running");
      if (configuringThreads.has(input.threadId)) throw new Error("AI: Thread configuration is updating");
      const request = sanitizeSubmit(input);
      const message = options
        ? {
            ...options.message,
            content: redactText(options.message.content),
            ...(options.message.displayContent ? { displayContent: redactText(options.message.displayContent) } : {}),
          }
        : request.message;
      let durable = await deps.threadRepository.get(request.threadId);
      const live = agentSessions.get(request.threadId)?.agentSession.durableSnapshot();
      if (
        (live?.view.timeline.length ?? durable?.view.timeline.length ?? 0) >= MAX_THREAD_TIMELINE_ITEMS ||
        (live?.modelHistory.length ?? durable?.modelHistory.length ?? 0) >= MAX_THREAD_MODEL_MESSAGES
      ) {
        throw new Error("AI: thread history limit reached; start a new Thread to continue");
      }
      const settings = await deps.getAISettings();
      const resolved = await deps.resolveProviderAccess(request.providerId ?? durable?.providerId);
      const selectedModel = request.model?.trim() || durable?.model;
      if (selectedModel) resolved.model = selectedModel;
      const accessProfile = request.accessProfile ?? durable?.accessProfile ?? DEFAULT_ACCESS_PROFILE;
      const requestedReasoning = request.reasoningLevel ?? durable?.reasoningLevel ?? "default";
      const reasoningLevel = reasoningCapability(resolved.id, resolved.model).levels.includes(requestedReasoning)
        ? requestedReasoning
        : "default";
      const permissions = deps.permissionsStore ? await deps.permissionsStore.load() : undefined;
      const permissionsUnreadable = permissions?.status === "error";
      const permissionMode = permissionsUnreadable ? "ask" : (settings.permissionMode ?? "ask");
      if (permissionsUnreadable) deps.logger?.error("AI: permissions cache unreadable — forcing 'ask'");
      const execution: AgentExecutionDeps = {
        runSandboxed,
        searchKnowledge: (query) => knowledgeBank.search(query),
        webSearch: settings.webSearch && deps.webSearcher ? deps.webSearcher : undefined,
        engineOps: deps.engineOps,
        workspaceAccess: deps.workspaceAccess,
        workspaceChanges: deps.workspaceChanges,
      };
      const redactedBundle = request.bundle ? redactPayload(request.bundle) : undefined;
      const projectPack = deps.projectContextHost ? await deps.projectContextHost.capture() : undefined;
      const projectPrompt =
        projectPack?.sections.length && deps.buildProjectContextPrompt
          ? deps.buildProjectContextPrompt(projectPack)
          : undefined;
      const permissionContext = {
        workspaceId:
          projectPack?.workspaceId ??
          (await sha256Text(`workspace:${settings.workspaceRoot?.trim() || "unconfigured"}`)),
        targetId: "host",
        subject: { kind: "access-profile" as const, id: accessProfile },
        contentTrustEpoch: projectPack?.fingerprint ?? "application",
      };
      const contextSources = [
        ...contextSourcesForBundle(redactedBundle),
        ...(projectPack?.sections.map(({ kind, trust, content }) => ({
          kind,
          trust,
          characters: content.length,
        })) ?? []),
        ...(options?.contextSources ?? []),
      ];
      const thinking = reasoningThinking(resolved.id, resolved.model, reasoningLevel);
      const taskSettings = {
        resolved,
        providerFetch: createProviderFetch(deps.providerTransport, resolved),
        system: [deps.buildAgentPrompt(redactedBundle), projectPrompt].filter(Boolean).join("\n\n"),
        permissionMode,
        permissions,
        permissionContext,
        ...(thinking ? { thinking } : {}),
        execution,
        ...(contextSources.length ? { contextSources } : {}),
        allowedTools: intersectTools(accessProfileTools(accessProfile), options?.allowedTools),
        ...(options?.initialTaint || projectPack?.initialTaint ? { initialTaint: true } : {}),
      };
      if (!agentSessions.has(request.threadId)) ensureCapacity();
      if (!durable) {
        const initial = createEmptyThreadRecord({
          id: request.threadId,
          title: request.history.find((message) => message.role === "user")?.content.slice(0, 48) || "New Thread",
          now: Date.now(),
          providerId: resolved.id,
          model: resolved.model,
          accessProfile,
          reasoningLevel,
        });
        initial.view = viewFromMessages(request.threadId, request.history);
        durable = await deps.threadRepository.create(initial);
      }
      let record = agentSessions.get(request.threadId);
      if (!record) {
        const holder = {
          threadId: request.threadId,
          observers: new Map<number | string, TEvent>(),
          providerId: resolved.id,
          model: resolved.model,
          accessProfile,
          reasoningLevel,
          deleted: false,
        } as AgentSessionRecord<TEvent>;
        observe(holder, event);
        holder.agentSession = createAgentSession({
          threadId: request.threadId,
          history: messagesFromThread(durable),
          view: durable.view,
          modelHistory: durable.modelHistory,
          activeCompaction: durable.compactions.find(({ id }) => id === durable.activeCompactionId),
          taskSettings,
          permissionsStore: deps.permissionsStore,
          storeToolArtifact: deps.storeToolArtifact,
          emit: (envelope) => {
            broadcast(holder, envelope);
            if (isDurableEvent(envelope)) {
              queueMicrotask(() =>
                persist(holder).catch((error) =>
                  deps.reportError("AI: thread persistence failed", holder.threadId, error),
                ),
              );
            }
          },
          logger: deps.logger,
        });
        record = holder;
        agentSessions.set(request.threadId, record);
      } else {
        observe(record, event);
        record.providerId = resolved.id;
        record.model = resolved.model;
        record.accessProfile = accessProfile;
        record.reasoningLevel = reasoningLevel;
      }
      return record.agentSession.submit(message, taskSettings);
    },
    resolve(event: TEvent, request: ResolveThreadApprovalRequest): Promise<ResolveThreadApprovalResult> {
      return requireAgentSession(event, request.threadId).agentSession.resolveApproval(
        request.approvalId,
        request.decision,
      );
    },
    async cancel(event: TEvent, threadId: string): Promise<{ ok: true }> {
      await requireAgentSession(event, threadId).agentSession.cancel();
      return { ok: true };
    },
    async snapshot(event: TEvent, threadId: string): Promise<ThreadView | null> {
      const record = find(event, threadId);
      return record?.agentSession.snapshot() ?? (await deps.threadRepository.get(threadId))?.view ?? null;
    },
    async delete(threadId: string): Promise<{ ok: true }> {
      const record = agentSessions.get(threadId);
      agentSessions.delete(threadId);
      if (record) record.deleted = true;
      await record?.agentSession.dispose();
      await deps.threadRepository.delete(threadId);
      await deps.deleteToolArtifacts?.(threadId);
      return { ok: true };
    },
    disposeForSender(senderId: number | string): void {
      for (const record of agentSessions.values()) record.observers.delete(senderId);
    },
    dispose(): void {
      for (const record of agentSessions.values()) {
        record.deleted = true;
        disposeAgentSession(record);
      }
      agentSessions.clear();
      void deps.threadRepository
        .dispose()
        .catch((error) => deps.reportError("AI: thread repository disposal failed", undefined, error));
    },
  };
}
