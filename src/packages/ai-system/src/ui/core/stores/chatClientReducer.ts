// Renderer-side chat projection and request lifecycle as a pure reducer. The host owns conversational execution;
// this owns renderer hydration, ordered projection, recovery, deletion tombstones, and the bookkeeping for every
// async host call. `chatClientReducer` is a pure `(state, event) => { state, effects }`: it never performs I/O —
// it returns Effects (a host request to run, a command outcome to settle, or an internal event to raise) that the
// runtime executes and feeds back as REQUEST_DONE / REQUEST_FAILED. Selection persistence and logging are the only
// injected side effects, called through `deps` exactly where the old machine called them.

import type {
  ChatEventEnvelope,
  ChatSessionView,
  ResolveChatApprovalResult,
  SubmitChatRequest,
  SubmitChatResult,
} from "@/ai-system/core/chatEvents";
import {
  chatTimelineMessageContent,
  emptyChatSessionView,
  reduceChatEvent,
  replaceChatSnapshot,
} from "@/ai-system/core/chatReducer";
import type { ConversationSummary, CreateConversationRequest } from "@/ai-system/core/conversations";
import type { ApprovalDecision, DiagnosticsBundle } from "@/ai-system/core/types";
import type { IAI } from "@/ai-system/host/aiClientBridge";
import i18n from "@/i18n";
import { randomUUID } from "@/utils/randomUUID";

const NEW_CHAT_TITLE = () => i18n.t("New chat");
const MAX_RECOVERY_BUFFER = 256;
const MAX_SNAPSHOT_FAILURES = 3;

export interface AIStoreDeps {
  getAI: () => IAI;
  log: { error: (...args: unknown[]) => void };
  collectBundle: () => DiagnosticsBundle;
  subscribeEvents?: (listener: (envelope: ChatEventEnvelope) => void) => () => void;
  loadSelectedSessionId?: () => string | null;
  saveSelectedSessionId?: (sessionId: string | null) => void;
}

export type SubmitOptions = Pick<SubmitChatRequest, "providerId" | "model">;

export type ClientCommandOutcome =
  | { type: "CLIENT.OUTCOME"; commandId: string; status: "resolved"; result?: unknown }
  | { type: "CLIENT.OUTCOME"; commandId: string; status: "rejected"; message: string };

export type ClientRequestInput =
  | { kind: "create"; request: CreateConversationRequest }
  | { kind: "submit"; request: Parameters<IAI["submitChat"]>[0] }
  | { kind: "approval"; sessionId: string; approvalId: string; decision: ApprovalDecision }
  | { kind: "snapshot"; sessionId: string }
  | { kind: "stop"; sessionId: string }
  | { kind: "delete"; sessionId: string };

export type ClientRequestOutput =
  | { kind: "create"; conversation: ConversationSummary }
  | { kind: "submit"; result: SubmitChatResult }
  | { kind: "approval"; result: ResolveChatApprovalResult }
  | { kind: "snapshot"; snapshot: ChatSessionView | null }
  | { kind: "stop" }
  | { kind: "delete"; result: Awaited<ReturnType<IAI["deleteChat"]>> };

type RequestMeta =
  | {
      kind: "create";
      commandIds: string[];
      sessionId: string;
      pendingSubmit?: Extract<ChatClientEvent, { type: "SUBMIT" }>;
      completionResult?: { ok: true };
    }
  | { kind: "submit"; commandIds: string[]; sessionId: string; messageId: string }
  | { kind: "approval"; commandIds: string[]; sessionId: string; approvalId: string }
  | { kind: "snapshot"; commandIds: string[]; sessionId: string; epoch: number }
  | { kind: "stop"; commandIds: string[]; sessionId: string }
  | { kind: "delete"; commandIds: string[]; sessionId: string; epoch: number };

export type ChatClientEvent =
  | {
      type: "NEW_SESSION";
      commandId?: string;
      deleteCompletion?: { commandIds: string[]; result: { ok: true } };
    }
  | { type: "SET_ACTIVE"; id: string }
  | { type: "SUBMIT"; commandId: string; text: string; options?: SubmitOptions }
  | { type: "APPLY_EVENT"; envelope: ChatEventEnvelope }
  | { type: "REFRESH"; sessionId: string; commandId?: string }
  | { type: "RESOLVE_APPROVAL"; commandId: string; approvalId: string; decision: ApprovalDecision }
  | { type: "CANCEL"; commandId: string }
  | { type: "DELETE"; commandId: string; id: string }
  | { type: "DEV_REPLACE_VIEW"; sessionId: string; view: ChatSessionView }
  | { type: "HYDRATE_DONE"; sessions: ConversationSummary[] }
  | { type: "HYDRATE_FAILED"; error: unknown }
  | { type: "REQUEST_DONE"; requestId: string; output: ClientRequestOutput }
  | { type: "REQUEST_FAILED"; requestId: string; error: unknown };

export interface ChatClientState {
  lifecycle: "hydrating" | "ready";
  sessions: ConversationSummary[];
  activeSessionId: string | null;
  views: Record<string, ChatSessionView>;
  recoveryBuffer: Record<string, ChatEventEnvelope[]>;
  recoveryErrors: Record<string, string>;
  snapshotFailures: Record<string, number>;
  requests: Record<string, RequestMeta>;
  requestCounter: number;
  sessionEpochs: Record<string, number>;
  tombstones: Set<string>;
  deletingSessions: Set<string>;
}

// An Effect is a side effect the runtime performs after applying the reduced state: run a host request (whose
// resolution/rejection re-enters as REQUEST_DONE / REQUEST_FAILED), settle a correlated command Promise, or raise
// an internal follow-up event (drained FIFO before control returns to the event loop).
export type Effect =
  | { type: "request"; requestId: string; input: ClientRequestInput }
  | { type: "outcome"; outcome: ClientCommandOutcome }
  | { type: "raise"; event: ChatClientEvent };

export interface ReduceResult {
  state: ChatClientState;
  effects: Effect[];
}

export function initialChatClientState(): ChatClientState {
  return {
    lifecycle: "hydrating",
    sessions: [],
    activeSessionId: null,
    views: {},
    recoveryBuffer: {},
    recoveryErrors: {},
    snapshotFailures: {},
    requests: {},
    requestCounter: 0,
    sessionEpochs: {},
    tombstones: new Set(),
    deletingSessions: new Set(),
  };
}

export async function runRequest(deps: AIStoreDeps, input: ClientRequestInput): Promise<ClientRequestOutput> {
  const ai = deps.getAI();
  switch (input.kind) {
    case "create":
      return { kind: "create", conversation: await ai.createChat(input.request) };
    case "submit":
      return { kind: "submit", result: await ai.submitChat(input.request) };
    case "approval":
      return {
        kind: "approval",
        result: await ai.resolveChatApproval({
          sessionId: input.sessionId,
          approvalId: input.approvalId,
          decision: input.decision,
        }),
      };
    case "snapshot":
      return { kind: "snapshot", snapshot: await ai.getChatSnapshot(input.sessionId) };
    case "stop":
      await ai.stopChat(input.sessionId);
      return { kind: "stop" };
    case "delete":
      return { kind: "delete", result: await ai.deleteChat(input.sessionId) };
  }
}

function messagesFromView(view: ChatSessionView): SubmitChatRequest["history"] {
  return view.timeline.flatMap((item, index) =>
    item.kind === "message" && item.delivery === "applied"
      ? [{ id: item.id, role: item.role, content: chatTimelineMessageContent(view, item, index), createdAt: index }]
      : [],
  );
}

function withApprovalStatus(
  view: ChatSessionView,
  approvalId: string,
  status: "pending" | "resolving",
): ChatSessionView {
  return {
    ...view,
    timeline: view.timeline.map((item) =>
      item.kind === "approval" && item.approvalId === approvalId ? { ...item, status } : item,
    ),
  };
}

function bufferEnvelope(
  buffer: ChatEventEnvelope[],
  envelope: ChatEventEnvelope,
  log: { error: (...args: unknown[]) => void },
): { events: ChatEventEnvelope[]; overflowed: boolean } {
  if (buffer.some((entry) => entry.seq === envelope.seq)) return { events: buffer, overflowed: false };
  const next = [...buffer, envelope].sort((a, b) => a.seq - b.seq);
  if (next.length > MAX_RECOVERY_BUFFER) {
    log.error("chat recovery buffer overflow", {
      sessionId: envelope.sessionId,
      dropped: next.length - MAX_RECOVERY_BUFFER,
    });
    return { events: next.slice(next.length - MAX_RECOVERY_BUFFER), overflowed: true };
  }
  return { events: next, overflowed: false };
}

function drainBuffer(
  view: ChatSessionView,
  buffer: ChatEventEnvelope[],
): { view: ChatSessionView; remaining: ChatEventEnvelope[]; needsSnapshot: boolean } {
  let current = view;
  let remaining = buffer.filter((entry) => entry.seq > current.lastSeq);
  for (;;) {
    const index = remaining.findIndex((entry) => entry.seq === current.lastSeq + 1);
    if (index === -1) break;
    current = reduceChatEvent(current, remaining[index]).view;
    remaining = remaining.filter((_, position) => position !== index);
  }
  return { view: current, remaining, needsSnapshot: remaining.length > 0 };
}

function newConversationRequest(): CreateConversationRequest {
  return { id: randomUUID(), title: NEW_CHAT_TITLE() };
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

function epoch(state: ChatClientState, sessionId: string): number {
  return state.sessionEpochs[sessionId] ?? 0;
}

function withoutRequest(state: ChatClientState, requestId: string): Record<string, RequestMeta> {
  const requests = { ...state.requests };
  delete requests[requestId];
  return requests;
}

function rememberSelection(deps: AIStoreDeps, sessionId: string | null): void {
  try {
    deps.saveSelectedSessionId?.(sessionId);
  } catch (error) {
    deps.log.error("chat selection persistence failed", error);
  }
}

function restoredSelection(deps: AIStoreDeps): string | null {
  try {
    return deps.loadSelectedSessionId?.() ?? null;
  } catch (error) {
    deps.log.error("chat selection restore failed", error);
    return null;
  }
}

// Faithful reduction of the old XState `enqueueActions` handlers: every value is computed from the incoming
// `state` (never a partially-updated copy), `assign` merges patches, and `raise`/`emit`/`spawn` accumulate Effects.
// `spawn` mirrors `enqueue.spawnChild`: bump the counter, record the request meta, and emit the request Effect.
export function chatClientReducer(deps: AIStoreDeps, state: ChatClientState, event: ChatClientEvent): ReduceResult {
  const effects: Effect[] = [];
  let next = state;
  const assign = (patch: Partial<ChatClientState>) => {
    next = { ...next, ...patch };
  };
  const raise = (raised: ChatClientEvent) => effects.push({ type: "raise", event: raised });
  const emit = (outcome: ClientCommandOutcome) => effects.push({ type: "outcome", outcome });
  const spawn = (input: ClientRequestInput, meta: RequestMeta) => {
    const requestCounter = next.requestCounter + 1;
    const requestId = `request:${requestCounter}`;
    assign({ requestCounter, requests: { ...next.requests, [requestId]: meta } });
    effects.push({ type: "request", requestId, input });
  };
  const done = (): ReduceResult => ({ state: next, effects });

  switch (event.type) {
    case "HYDRATE_DONE": {
      assign({ lifecycle: "ready" });
      const loaded = event.sessions;
      const liveIds = new Set(state.sessions.map((session) => session.id));
      const stored = loaded.filter((session) => !liveIds.has(session.id) && !state.tombstones.has(session.id));
      const sessions = [...stored, ...state.sessions];
      const loadedViews = Object.fromEntries(stored.map((session) => [session.id, emptyChatSessionView(session.id)]));
      const sessionEpochs = {
        ...Object.fromEntries(stored.map((session) => [session.id, 1])),
        ...state.sessionEpochs,
      };
      if (sessions.length === 0) {
        if (!Object.values(state.requests).some((request) => request.kind === "create")) {
          raise({ type: "NEW_SESSION" });
        }
        return done();
      }
      const preferred = restoredSelection(deps);
      const activeSessionId =
        state.activeSessionId ??
        (preferred && sessions.some((session) => session.id === preferred) ? preferred : sessions.at(-1)?.id) ??
        null;
      assign({ sessions, activeSessionId, views: { ...loadedViews, ...state.views }, sessionEpochs });
      rememberSelection(deps, activeSessionId);
      if (activeSessionId && stored.some((session) => session.id === activeSessionId)) {
        raise({ type: "REFRESH", sessionId: activeSessionId });
      }
      return done();
    }

    case "HYDRATE_FAILED": {
      assign({ lifecycle: "ready" });
      deps.log.error("chat hydration failed", event.error);
      if (state.sessions.length === 0 && !Object.values(state.requests).some((request) => request.kind === "create")) {
        raise({ type: "NEW_SESSION" });
      }
      return done();
    }

    case "APPLY_EVENT": {
      const { envelope } = event;
      if (state.tombstones.has(envelope.sessionId)) return done();
      const current = state.views[envelope.sessionId] ?? emptyChatSessionView(envelope.sessionId);
      const reduced = reduceChatEvent(current, envelope);
      if (reduced.needsSnapshot) {
        const buffered = bufferEnvelope(state.recoveryBuffer[envelope.sessionId] ?? [], envelope, deps.log);
        assign({
          recoveryBuffer: { ...state.recoveryBuffer, [envelope.sessionId]: buffered.events },
          ...(buffered.overflowed
            ? {
                recoveryErrors: {
                  ...state.recoveryErrors,
                  [envelope.sessionId]: "Too many events arrived while recovering this conversation",
                },
              }
            : {}),
        });
        raise({ type: "REFRESH", sessionId: envelope.sessionId });
        return done();
      }
      const drained = drainBuffer(reduced.view, state.recoveryBuffer[envelope.sessionId] ?? []);
      const recoveryErrors = { ...state.recoveryErrors };
      delete recoveryErrors[envelope.sessionId];
      const knownSession = state.sessions.some((session) => session.id === envelope.sessionId);
      const now = Date.now();
      const firstUser = drained.view.timeline.find(
        (item) => item.kind === "message" && item.role === "user" && item.delivery === "applied",
      );
      const sessions = knownSession
        ? state.sessions.map((session) =>
            session.id === envelope.sessionId
              ? {
                  ...session,
                  title:
                    session.lastSeq === 0 && firstUser?.kind === "message"
                      ? firstUser.content.slice(0, 48)
                      : session.title,
                  updatedAt: now,
                  phase: drained.view.phase,
                  lastSeq: drained.view.lastSeq,
                }
              : session,
          )
        : [
            ...state.sessions,
            {
              id: envelope.sessionId,
              title: firstUser?.kind === "message" ? firstUser.content.slice(0, 48) : NEW_CHAT_TITLE(),
              createdAt: now,
              updatedAt: now,
              phase: drained.view.phase,
              lastSeq: drained.view.lastSeq,
            },
          ];
      assign({
        sessions,
        views: { ...state.views, [envelope.sessionId]: drained.view },
        recoveryBuffer: { ...state.recoveryBuffer, [envelope.sessionId]: drained.remaining },
        recoveryErrors,
        activeSessionId: state.activeSessionId ?? envelope.sessionId,
        sessionEpochs: knownSession ? state.sessionEpochs : { ...state.sessionEpochs, [envelope.sessionId]: 1 },
      });
      if (drained.needsSnapshot) raise({ type: "REFRESH", sessionId: envelope.sessionId });
      return done();
    }

    case "NEW_SESSION": {
      const request = newConversationRequest();
      spawn(
        { kind: "create", request },
        {
          kind: "create",
          commandIds: event.deleteCompletion?.commandIds ?? (event.commandId ? [event.commandId] : []),
          sessionId: request.id,
          completionResult: event.deleteCompletion?.result,
        },
      );
      return done();
    }

    case "SET_ACTIVE": {
      if (state.tombstones.has(event.id) || !state.sessions.some((session) => session.id === event.id)) return done();
      assign({ activeSessionId: event.id });
      rememberSelection(deps, event.id);
      raise({ type: "REFRESH", sessionId: event.id });
      return done();
    }

    case "SUBMIT": {
      const content = event.text.trim();
      if (!content) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        const request = newConversationRequest();
        spawn(
          { kind: "create", request },
          { kind: "create", commandIds: [], sessionId: request.id, pendingSubmit: event },
        );
        return done();
      }
      const id = randomUUID();
      const view = state.views[sessionId] ?? emptyChatSessionView(sessionId);
      const request = {
        sessionId,
        message: { id, content, createdAt: Date.now() },
        history: messagesFromView(view),
        providerId: event.options?.providerId,
        model: event.options?.model,
        bundle: deps.collectBundle(),
      };
      spawn({ kind: "submit", request }, { kind: "submit", commandIds: [event.commandId], sessionId, messageId: id });
      return done();
    }

    case "RESOLVE_APPROVAL": {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      const view = state.views[sessionId];
      if (view) {
        assign({ views: { ...state.views, [sessionId]: withApprovalStatus(view, event.approvalId, "resolving") } });
      }
      spawn(
        { kind: "approval", sessionId, approvalId: event.approvalId, decision: event.decision },
        { kind: "approval", commandIds: [event.commandId], sessionId, approvalId: event.approvalId },
      );
      return done();
    }

    case "REFRESH": {
      const existing = Object.entries(state.requests).find(
        ([, request]) => request.kind === "snapshot" && request.sessionId === event.sessionId,
      );
      if (existing) {
        if (event.commandId) {
          const [requestId, request] = existing as [string, Extract<RequestMeta, { kind: "snapshot" }>];
          assign({
            requests: {
              ...state.requests,
              [requestId]: { ...request, commandIds: [...request.commandIds, event.commandId] },
            },
          });
        }
        return done();
      }
      if (state.tombstones.has(event.sessionId)) {
        if (event.commandId) emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      spawn(
        { kind: "snapshot", sessionId: event.sessionId },
        {
          kind: "snapshot",
          commandIds: event.commandId ? [event.commandId] : [],
          sessionId: event.sessionId,
          epoch: epoch(state, event.sessionId),
        },
      );
      return done();
    }

    case "CANCEL": {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      spawn({ kind: "stop", sessionId }, { kind: "stop", commandIds: [event.commandId], sessionId });
      return done();
    }

    case "DELETE": {
      if (state.tombstones.has(event.id)) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      const nextEpoch = epoch(state, event.id) + 1;
      assign({
        tombstones: new Set(state.tombstones).add(event.id),
        deletingSessions: new Set(state.deletingSessions).add(event.id),
        sessionEpochs: { ...state.sessionEpochs, [event.id]: nextEpoch },
      });
      spawn(
        { kind: "delete", sessionId: event.id },
        { kind: "delete", commandIds: [event.commandId], sessionId: event.id, epoch: nextEpoch },
      );
      return done();
    }

    case "DEV_REPLACE_VIEW": {
      if (
        event.view.sessionId !== event.sessionId ||
        state.tombstones.has(event.sessionId) ||
        !state.sessions.some((session) => session.id === event.sessionId)
      ) {
        return done();
      }
      assign({ views: { ...state.views, [event.sessionId]: event.view } });
      return done();
    }

    case "REQUEST_DONE":
      return reduceRequestDone(deps, state, event, { assign, raise, emit, done });

    case "REQUEST_FAILED":
      return reduceRequestFailed(deps, state, event, { assign, raise, emit, done });
  }
}

interface ReduceHelpers {
  assign: (patch: Partial<ChatClientState>) => void;
  raise?: (event: ChatClientEvent) => void;
  emit: (outcome: ClientCommandOutcome) => void;
  done: () => ReduceResult;
}

function reduceRequestDone(
  deps: AIStoreDeps,
  state: ChatClientState,
  event: Extract<ChatClientEvent, { type: "REQUEST_DONE" }>,
  { assign, raise, emit, done }: Required<ReduceHelpers>,
): ReduceResult {
  const meta = state.requests[event.requestId];
  if (!meta) return done();
  assign({ requests: withoutRequest(state, event.requestId) });
  const output = event.output;

  if (meta.kind === "create" && output.kind === "create") {
    const conversation = output.conversation;
    const known = state.sessions.some((session) => session.id === conversation.id);
    assign({
      sessions: known
        ? state.sessions.map((session) => (session.id === conversation.id ? conversation : session))
        : [...state.sessions, conversation],
      activeSessionId: conversation.id,
      views: {
        ...state.views,
        [conversation.id]: state.views[conversation.id] ?? emptyChatSessionView(conversation.id),
      },
      sessionEpochs: { ...state.sessionEpochs, [conversation.id]: state.sessionEpochs[conversation.id] ?? 1 },
    });
    rememberSelection(deps, conversation.id);
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: meta.completionResult ?? conversation.id });
    }
    if (meta.pendingSubmit) raise(meta.pendingSubmit);
    return done();
  }

  if (meta.kind === "submit" && output.kind === "submit") {
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.result });
    }
    const view = state.views[meta.sessionId];
    const known = view?.timeline.some((item) => item.kind === "message" && item.id === meta.messageId);
    if (!known) raise({ type: "REFRESH", sessionId: meta.sessionId });
    return done();
  }

  if (meta.kind === "approval" && output.kind === "approval") {
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.result });
    }
    if (!output.result.accepted) {
      const view = state.views[meta.sessionId];
      if (view)
        assign({ views: { ...state.views, [meta.sessionId]: withApprovalStatus(view, meta.approvalId, "pending") } });
    }
    return done();
  }

  if (meta.kind === "stop" && output.kind === "stop") {
    for (const commandId of meta.commandIds) emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved" });
    return done();
  }

  if (meta.kind === "snapshot" && output.kind === "snapshot") {
    for (const commandId of meta.commandIds) emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved" });
    if (state.tombstones.has(meta.sessionId) || meta.epoch !== epoch(state, meta.sessionId)) return done();
    if (!output.snapshot) {
      const buffered = state.recoveryBuffer[meta.sessionId] ?? [];
      if (buffered.length > 0) {
        const failures = (state.snapshotFailures[meta.sessionId] ?? 0) + 1;
        assign({ snapshotFailures: { ...state.snapshotFailures, [meta.sessionId]: failures } });
        if (failures < MAX_SNAPSHOT_FAILURES) raise({ type: "REFRESH", sessionId: meta.sessionId });
        else
          assign({
            recoveryErrors: { ...state.recoveryErrors, [meta.sessionId]: "Unable to recover this conversation" },
          });
      }
      return done();
    }
    const base = state.views[meta.sessionId] ?? emptyChatSessionView(meta.sessionId);
    const drained = drainBuffer(replaceChatSnapshot(base, output.snapshot), state.recoveryBuffer[meta.sessionId] ?? []);
    const failures = { ...state.snapshotFailures };
    delete failures[meta.sessionId];
    const recoveryErrors = { ...state.recoveryErrors };
    delete recoveryErrors[meta.sessionId];
    assign({
      views: { ...state.views, [meta.sessionId]: drained.view },
      sessions: state.sessions.map((session) =>
        session.id === meta.sessionId
          ? { ...session, phase: drained.view.phase, lastSeq: drained.view.lastSeq }
          : session,
      ),
      recoveryBuffer: { ...state.recoveryBuffer, [meta.sessionId]: drained.remaining },
      snapshotFailures: failures,
      recoveryErrors,
    });
    if (drained.needsSnapshot) raise({ type: "REFRESH", sessionId: meta.sessionId });
    return done();
  }

  if (meta.kind === "delete" && output.kind === "delete") {
    const views = { ...state.views };
    delete views[meta.sessionId];
    const recoveryBuffer = { ...state.recoveryBuffer };
    delete recoveryBuffer[meta.sessionId];
    const recoveryErrors = { ...state.recoveryErrors };
    delete recoveryErrors[meta.sessionId];
    const deletingSessions = new Set(state.deletingSessions);
    deletingSessions.delete(meta.sessionId);
    const sessions = state.sessions.filter((session) => session.id !== meta.sessionId);
    const activeSessionId =
      state.activeSessionId === meta.sessionId ? (sessions.at(-1)?.id ?? null) : state.activeSessionId;
    if (!activeSessionId) {
      raise({ type: "NEW_SESSION", deleteCompletion: { commandIds: meta.commandIds, result: output.result } });
    } else {
      rememberSelection(deps, activeSessionId);
      for (const commandId of meta.commandIds) {
        emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.result });
      }
    }
    assign({ sessions, views, recoveryBuffer, recoveryErrors, deletingSessions, activeSessionId });
  }
  return done();
}

function reduceRequestFailed(
  deps: AIStoreDeps,
  state: ChatClientState,
  event: Extract<ChatClientEvent, { type: "REQUEST_FAILED" }>,
  { assign, raise, emit, done }: Required<ReduceHelpers>,
): ReduceResult {
  const meta = state.requests[event.requestId];
  if (!meta) return done();
  assign({ requests: withoutRequest(state, event.requestId) });
  const message = errorMessage(event.error);
  deps.log.error(`chat ${meta.kind} failed`, { sessionId: meta.sessionId, error: message });
  for (const commandId of meta.commandIds) {
    emit({ type: "CLIENT.OUTCOME", commandId, status: "rejected", message });
  }
  if (meta.kind === "create" && meta.pendingSubmit) {
    emit({ type: "CLIENT.OUTCOME", commandId: meta.pendingSubmit.commandId, status: "rejected", message });
  } else if (meta.kind === "approval") {
    const view = state.views[meta.sessionId];
    if (view)
      assign({ views: { ...state.views, [meta.sessionId]: withApprovalStatus(view, meta.approvalId, "pending") } });
  } else if (meta.kind === "snapshot") {
    const failures = (state.snapshotFailures[meta.sessionId] ?? 0) + 1;
    assign({
      snapshotFailures: { ...state.snapshotFailures, [meta.sessionId]: failures },
      recoveryErrors: { ...state.recoveryErrors, [meta.sessionId]: message },
    });
    if (
      (state.recoveryBuffer[meta.sessionId]?.length ?? 0) > 0 &&
      failures < MAX_SNAPSHOT_FAILURES &&
      !state.tombstones.has(meta.sessionId)
    ) {
      raise({ type: "REFRESH", sessionId: meta.sessionId });
    }
  } else if (meta.kind === "delete") {
    const deletingSessions = new Set(state.deletingSessions);
    deletingSessions.delete(meta.sessionId);
    const tombstones = new Set(state.tombstones);
    tombstones.delete(meta.sessionId);
    assign({ deletingSessions, tombstones });
  }
  return done();
}
