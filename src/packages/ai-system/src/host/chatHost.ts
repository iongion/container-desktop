import { createProviderFetch } from "@/ai-system/adapters/providerFetch";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import {
  type ChatEventEnvelope,
  type ChatSessionView,
  type ChatTimelineItem,
  MAX_INITIAL_HISTORY_CHARS,
  type ResolveChatApprovalRequest,
  type ResolveChatApprovalResult,
  type SubmitChatRequest,
  type SubmitChatResult,
} from "@/ai-system/core/chatEvents";
import { viewFromMessages } from "@/ai-system/core/chatReducer";
import {
  type ConversationRecordV1,
  type ConversationSummary,
  type CreateConversationRequest,
  conversationSummary,
  createEmptyConversationRecord,
} from "@/ai-system/core/conversations";
import {
  MAX_ACTIVE_CHAT_SESSIONS,
  MAX_CONVERSATION_MODEL_MESSAGES,
  MAX_CONVERSATION_TIMELINE_ITEMS,
  MAX_DIAGNOSTICS_BUNDLE_CHARS,
} from "@/ai-system/core/limits";
import type { PermissionsStoreLike } from "@/ai-system/core/permissions";
import type { AgentExecutionDeps, KnowledgeBankLike, SandboxRunner } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { redactPayload, redactText } from "@/ai-system/core/redact";
import type {
  AISettings,
  ChatMessage,
  CreateAgentSession,
  DiagnosticsBundle,
  EngineOps,
  ProviderTransport,
} from "@/ai-system/core/types";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import type { ConversationRepository } from "./conversationRepository";

const DIAGNOSTICS_FIELDS = ["os", "engine", "connection", "screen", "activity", "resources", "errors"] as const;

interface SessionRecord<TEvent> {
  sessionId: string;
  session: ReturnType<CreateAgentSession>;
  observers: Map<number | string, TEvent>;
  providerId?: string;
  model?: string;
  deleted: boolean;
}

export interface ChatHostDeps<TEvent> {
  senderId: (event: TEvent) => number | string;
  send: (event: TEvent, channel: typeof AI_CHANNELS.chatEvent, payload: ChatEventEnvelope) => void;
  getAISettings: () => Promise<AISettings> | AISettings;
  resolveProviderAccess: (providerId?: string) => Promise<ResolvedProvider>;
  providerTransport: ProviderTransport;
  buildAgentPrompt: (bundle?: DiagnosticsBundle) => string;
  createAgentSession?: CreateAgentSession;
  runSandboxed?: SandboxRunner;
  engineOps?: EngineOps;
  workspaceAccess?: IWorkspaceAccess;
  permissionsStore?: PermissionsStoreLike;
  knowledgeBank?: KnowledgeBankLike;
  webSearcher?: (query: string) => Promise<{ text: string }>;
  conversationRepository: ConversationRepository;
  reportError: (message: string, id: string | undefined, error: unknown) => void;
  logger?: { error: (...args: unknown[]) => void };
}

function sanitizeMessage(value: SubmitChatRequest["history"][number]): SubmitChatRequest["history"][number] {
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

function sanitizeSubmit(request: SubmitChatRequest): SubmitChatRequest {
  const content = request.message.content.trim();
  const history = request.history.map(sanitizeMessage);
  if (history.reduce((total, entry) => total + entry.content.length, 0) > MAX_INITIAL_HISTORY_CHARS) {
    throw new Error("AI: initial chat history is too large");
  }
  return {
    ...request,
    message: { ...request.message, content: redactText(content) },
    history,
    bundle: sanitizeBundle(request.bundle),
  };
}

function messagesFromConversation(record: ConversationRecordV1): ChatMessage[] {
  return record.view.timeline.flatMap((item, index) =>
    item.kind === "message" && item.delivery === "applied"
      ? [{ id: item.id, role: item.role, content: item.content, createdAt: index }]
      : [],
  );
}

const isDurableEvent = (envelope: ChatEventEnvelope): boolean =>
  envelope.event.type !== "assistant-start" && envelope.event.type !== "assistant-delta";

const isAppliedUserMessage = (item: ChatTimelineItem): boolean =>
  item.kind === "message" && item.role === "user" && item.delivery === "applied";

export function createChatHost<TEvent>(deps: ChatHostDeps<TEvent>) {
  const sessions = new Map<string, SessionRecord<TEvent>>();

  const observe = (record: SessionRecord<TEvent>, event: TEvent): void => {
    record.observers.set(deps.senderId(event), event);
  };

  const find = (event: TEvent, sessionId: string): SessionRecord<TEvent> | undefined => {
    const record = sessions.get(sessionId);
    if (record) observe(record, event);
    return record;
  };

  const requireSession = (event: TEvent, sessionId: string): SessionRecord<TEvent> => {
    const record = find(event, sessionId);
    if (!record) throw new Error("AI: chat session not found");
    return record;
  };

  const broadcast = (record: SessionRecord<TEvent>, envelope: ChatEventEnvelope): void => {
    for (const [senderId, event] of record.observers) {
      try {
        deps.send(event, AI_CHANNELS.chatEvent, envelope);
      } catch (error) {
        record.observers.delete(senderId);
        deps.reportError("AI: chat observer delivery failed", record.sessionId, error);
      }
    }
  };

  const isCurrent = (record: SessionRecord<TEvent>): boolean =>
    !record.deleted && sessions.get(record.sessionId) === record;

  const persist = async (record: SessionRecord<TEvent>): Promise<void> => {
    if (!isCurrent(record)) return;
    const durable = record.session.durableSnapshot();
    const existing = await deps.conversationRepository.get(record.sessionId);
    if (!existing || !isCurrent(record)) return;
    const firstUser = durable.view.timeline.find(isAppliedUserMessage);
    const previouslyHadUser = existing.view.timeline.some(isAppliedUserMessage);
    await deps.conversationRepository.upsert({
      ...existing,
      title: !previouslyHadUser && firstUser?.kind === "message" ? firstUser.content.slice(0, 48) : existing.title,
      updatedAt: Date.now(),
      ...(record.providerId ? { providerId: record.providerId } : {}),
      ...(record.model ? { model: record.model } : {}),
      view: durable.view,
      modelHistory: durable.modelHistory,
    });
  };

  const disposeSession = (record: SessionRecord<TEvent>): void => {
    void record.session
      .dispose()
      .catch((error) => deps.reportError("AI: chat session disposal failed", record.sessionId, error));
  };

  const ensureCapacity = (): void => {
    if (sessions.size < MAX_ACTIVE_CHAT_SESSIONS) return;
    for (const [sessionId, record] of sessions) {
      if (["idle", "error"].includes(record.session.snapshot().phase)) {
        sessions.delete(sessionId);
        disposeSession(record);
        return;
      }
    }
    throw new Error("AI: too many active conversations");
  };

  return {
    list(): Promise<ConversationSummary[]> {
      return deps.conversationRepository.list();
    },
    async create(request: CreateConversationRequest): Promise<ConversationSummary> {
      const existing = await deps.conversationRepository.get(request.id);
      if (existing) return conversationSummary(existing);
      const created = await deps.conversationRepository.create(
        createEmptyConversationRecord({
          ...request,
          title: redactText(request.title),
          now: Date.now(),
          model: request.model?.trim() || undefined,
        }),
      );
      return conversationSummary(created);
    },
    async submit(event: TEvent, input: SubmitChatRequest): Promise<SubmitChatResult> {
      const { createAgentSession, runSandboxed, knowledgeBank } = deps;
      if (!createAgentSession || !runSandboxed || !knowledgeBank) throw new Error("AI: the assistant is not available");
      const request = sanitizeSubmit(input);
      let durable = await deps.conversationRepository.get(request.sessionId);
      const live = sessions.get(request.sessionId)?.session.durableSnapshot();
      if (
        (live?.view.timeline.length ?? durable?.view.timeline.length ?? 0) >= MAX_CONVERSATION_TIMELINE_ITEMS ||
        (live?.modelHistory.length ?? durable?.modelHistory.length ?? 0) >= MAX_CONVERSATION_MODEL_MESSAGES
      ) {
        throw new Error("AI: conversation history limit reached; start a new chat to continue");
      }
      const settings = await deps.getAISettings();
      const resolved = await deps.resolveProviderAccess(request.providerId ?? durable?.providerId);
      const selectedModel = request.model?.trim() || durable?.model;
      if (selectedModel) resolved.model = selectedModel;
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
      };
      const taskSettings = {
        resolved,
        providerFetch: createProviderFetch(deps.providerTransport, resolved),
        system: deps.buildAgentPrompt(request.bundle ? redactPayload(request.bundle) : undefined),
        permissionMode,
        permissions,
        execution,
      };
      if (!sessions.has(request.sessionId)) ensureCapacity();
      if (!durable) {
        const initial = createEmptyConversationRecord({
          id: request.sessionId,
          title: request.history.find((message) => message.role === "user")?.content.slice(0, 48) || "New chat",
          now: Date.now(),
          providerId: resolved.id,
          model: resolved.model,
        });
        initial.view = viewFromMessages(request.sessionId, request.history);
        durable = await deps.conversationRepository.create(initial);
      }
      let record = sessions.get(request.sessionId);
      if (!record) {
        const holder = {
          sessionId: request.sessionId,
          observers: new Map<number | string, TEvent>(),
          providerId: resolved.id,
          model: resolved.model,
          deleted: false,
        } as SessionRecord<TEvent>;
        observe(holder, event);
        holder.session = createAgentSession({
          sessionId: request.sessionId,
          history: messagesFromConversation(durable),
          modelHistory: durable.modelHistory,
          taskSettings,
          permissionsStore: deps.permissionsStore,
          emit: (envelope) => {
            broadcast(holder, envelope);
            if (isDurableEvent(envelope)) {
              queueMicrotask(() =>
                persist(holder).catch((error) =>
                  deps.reportError("AI: conversation persistence failed", holder.sessionId, error),
                ),
              );
            }
          },
          logger: deps.logger,
        });
        record = holder;
        sessions.set(request.sessionId, record);
      } else {
        observe(record, event);
        record.providerId = resolved.id;
        record.model = resolved.model;
      }
      return record.session.submit(request.message, taskSettings);
    },
    resolve(event: TEvent, request: ResolveChatApprovalRequest): Promise<ResolveChatApprovalResult> {
      return requireSession(event, request.sessionId).session.resolveApproval(request.approvalId, request.decision);
    },
    async cancel(event: TEvent, sessionId: string): Promise<{ ok: true }> {
      await requireSession(event, sessionId).session.cancel();
      return { ok: true };
    },
    async snapshot(event: TEvent, sessionId: string): Promise<ChatSessionView | null> {
      const record = find(event, sessionId);
      return record?.session.snapshot() ?? (await deps.conversationRepository.get(sessionId))?.view ?? null;
    },
    async delete(sessionId: string): Promise<{ ok: true }> {
      const record = sessions.get(sessionId);
      sessions.delete(sessionId);
      if (record) record.deleted = true;
      await record?.session.dispose();
      await deps.conversationRepository.delete(sessionId);
      return { ok: true };
    },
    disposeForSender(senderId: number | string): void {
      for (const record of sessions.values()) record.observers.delete(senderId);
    },
    dispose(): void {
      for (const record of sessions.values()) {
        record.deleted = true;
        disposeSession(record);
      }
      sessions.clear();
      void deps.conversationRepository
        .dispose()
        .catch((error) => deps.reportError("AI: conversation repository disposal failed", undefined, error));
    },
  };
}
