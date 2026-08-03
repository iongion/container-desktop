// Renderer-side Thread projection and request lifecycle as a pure reducer. The host owns Thread execution;
// this owns renderer hydration, ordered projection, recovery, deletion tombstones, and the bookkeeping for every
// async host call. `threadClientReducer` is a pure `(state, event) => { state, effects }`: it never performs I/O —
// it returns Effects (a host request to run, a command outcome to settle, or an internal event to raise) that the
// runtime executes and feeds back as REQUEST_DONE / REQUEST_FAILED. Selection persistence and logging are the only
// injected side effects, called through `deps` exactly where the old machine called them.

import type { ThreadCompactionRevision } from "@/ai-system/core/threadCompaction";
import type { SubmitThreadRequest, ThreadEventEnvelope, ThreadView } from "@/ai-system/core/threadEvents";
import { emptyThreadView, reduceThreadEvent, threadTimelineMessageContent } from "@/ai-system/core/threadReducer";
import type { CreateThreadRequest, ThreadConfigurationPatch, ThreadSummary } from "@/ai-system/core/threads";
import type { ApprovalDecision, DiagnosticsBundle } from "@/ai-system/core/types";
import type { IAI } from "@/ai-system/host/aiClientBridge";
import i18n from "@/i18n";
import { randomUUID } from "@/utils/randomUUID";
import { reduceRequestDone, reduceRequestFailed } from "./threadClientRequestResults";
import type { ClientRequestInput, ClientRequestOutput } from "./threadClientRequests";
import {
  bufferEnvelope,
  drainBuffer,
  mostRecentThreadId,
  rememberSelection,
  restoredSelection,
  threadEpoch,
  withApprovalStatus,
} from "./threadClientStateUtils";

const NEW_THREAD_TITLE = () => i18n.t("New Thread");

export interface AIStoreDeps {
  getAI: () => IAI;
  log: { error: (...args: unknown[]) => void };
  collectBundle: () => DiagnosticsBundle;
  subscribeEvents?: (listener: (envelope: ThreadEventEnvelope) => void) => () => void;
  loadSelectedThreadId?: () => string | null;
  saveSelectedThreadId?: (threadId: string | null) => void;
}

export type SubmitOptions = Pick<SubmitThreadRequest, "providerId" | "model" | "accessProfile" | "reasoningLevel">;

export type ClientCommandOutcome =
  | { type: "CLIENT.OUTCOME"; commandId: string; status: "resolved"; result?: unknown }
  | { type: "CLIENT.OUTCOME"; commandId: string; status: "rejected"; message: string };

export type RequestMeta =
  | {
      kind: "create";
      commandIds: string[];
      threadId: string;
      pendingSubmit?: Extract<ThreadClientEvent, { type: "SUBMIT" }>;
      completionResult?: { ok: true };
    }
  | { kind: "rename"; commandIds: string[]; threadId: string }
  | { kind: "configure"; commandIds: string[]; threadId: string }
  | { kind: "branch-preview"; commandIds: string[]; threadId: string }
  | { kind: "branch"; commandIds: string[]; threadId: string }
  | { kind: "compaction-preview"; commandIds: string[]; threadId: string }
  | { kind: "compact"; commandIds: string[]; threadId: string }
  | { kind: "submit"; commandIds: string[]; threadId: string; messageId: string }
  | { kind: "approval"; commandIds: string[]; threadId: string; approvalId: string }
  | { kind: "snapshot"; commandIds: string[]; threadId: string; epoch: number }
  | { kind: "stop"; commandIds: string[]; threadId: string }
  | { kind: "delete"; commandIds: string[]; threadId: string; epoch: number };

export type ThreadClientEvent =
  | {
      type: "NEW_THREAD";
      commandId?: string;
      deleteCompletion?: { commandIds: string[]; result: { ok: true } };
    }
  | { type: "SET_ACTIVE"; id: string }
  | { type: "RENAME"; commandId: string; id: string; title: string }
  | { type: "CONFIGURE"; commandId: string; id: string; patch: ThreadConfigurationPatch }
  | { type: "BRANCH_PREVIEW"; commandId: string; threadId: string }
  | { type: "BRANCH"; commandId: string; threadId: string; checkpointId: string; title: string }
  | { type: "COMPACTION_PREVIEW"; commandId: string; threadId: string }
  | {
      type: "COMPACT";
      commandId: string;
      threadId: string;
      revision: ThreadCompactionRevision;
      instructions?: string;
    }
  | { type: "SUBMIT"; commandId: string; text: string; options?: SubmitOptions }
  | { type: "APPLY_EVENT"; envelope: ThreadEventEnvelope }
  | { type: "REFRESH"; threadId: string; commandId?: string }
  | { type: "RESOLVE_APPROVAL"; commandId: string; approvalId: string; decision: ApprovalDecision }
  | { type: "CANCEL"; commandId: string }
  | { type: "DELETE"; commandId: string; id: string }
  | { type: "DEV_REPLACE_VIEW"; threadId: string; view: ThreadView }
  | { type: "HYDRATE_DONE"; threads: ThreadSummary[] }
  | { type: "HYDRATE_FAILED"; error: unknown }
  | { type: "REQUEST_DONE"; requestId: string; output: ClientRequestOutput }
  | { type: "REQUEST_FAILED"; requestId: string; error: unknown };

export interface ThreadClientState {
  lifecycle: "hydrating" | "ready";
  threads: ThreadSummary[];
  activeThreadId: string | null;
  views: Record<string, ThreadView>;
  recoveryBuffer: Record<string, ThreadEventEnvelope[]>;
  recoveryErrors: Record<string, string>;
  snapshotFailures: Record<string, number>;
  requests: Record<string, RequestMeta>;
  requestCounter: number;
  threadEpochs: Record<string, number>;
  tombstones: Set<string>;
  deletingThreads: Set<string>;
}

// An Effect is a side effect the runtime performs after applying the reduced state: run a host request (whose
// resolution/rejection re-enters as REQUEST_DONE / REQUEST_FAILED), settle a correlated command Promise, or raise
// an internal follow-up event (drained FIFO before control returns to the event loop).
export type Effect =
  | { type: "request"; requestId: string; input: ClientRequestInput }
  | { type: "outcome"; outcome: ClientCommandOutcome }
  | { type: "raise"; event: ThreadClientEvent };

export interface ReduceResult {
  state: ThreadClientState;
  effects: Effect[];
}

export function initialThreadClientState(): ThreadClientState {
  return {
    lifecycle: "hydrating",
    threads: [],
    activeThreadId: null,
    views: {},
    recoveryBuffer: {},
    recoveryErrors: {},
    snapshotFailures: {},
    requests: {},
    requestCounter: 0,
    threadEpochs: {},
    tombstones: new Set(),
    deletingThreads: new Set(),
  };
}

function messagesFromView(view: ThreadView): SubmitThreadRequest["history"] {
  return view.timeline.flatMap((item, index) =>
    item.kind === "message" && item.delivery === "applied"
      ? [{ id: item.id, role: item.role, content: threadTimelineMessageContent(view, item, index), createdAt: index }]
      : [],
  );
}

function newThreadRequest(): CreateThreadRequest {
  return { id: randomUUID(), title: NEW_THREAD_TITLE() };
}

// Faithful reduction of the old XState `enqueueActions` handlers: every value is computed from the incoming
// `state` (never a partially-updated copy), `assign` merges patches, and `raise`/`emit`/`spawn` accumulate Effects.
// `spawn` mirrors `enqueue.spawnChild`: bump the counter, record the request meta, and emit the request Effect.
export function threadClientReducer(
  deps: AIStoreDeps,
  state: ThreadClientState,
  event: ThreadClientEvent,
): ReduceResult {
  const effects: Effect[] = [];
  let next = state;
  const assign = (patch: Partial<ThreadClientState>) => {
    next = { ...next, ...patch };
  };
  const raise = (raised: ThreadClientEvent) => effects.push({ type: "raise", event: raised });
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
      const loaded = event.threads;
      const liveIds = new Set(state.threads.map((thread) => thread.id));
      const stored = loaded.filter((thread) => !liveIds.has(thread.id) && !state.tombstones.has(thread.id));
      const threads = [...stored, ...state.threads];
      const loadedViews = Object.fromEntries(stored.map((thread) => [thread.id, emptyThreadView(thread.id)]));
      const threadEpochs = {
        ...Object.fromEntries(stored.map((thread) => [thread.id, 1])),
        ...state.threadEpochs,
      };
      if (threads.length === 0) {
        if (!Object.values(state.requests).some((request) => request.kind === "create")) {
          raise({ type: "NEW_THREAD" });
        }
        return done();
      }
      const preferred = restoredSelection(deps);
      const activeThreadId =
        state.activeThreadId ??
        (preferred && threads.some((thread) => thread.id === preferred) ? preferred : mostRecentThreadId(threads));
      assign({ threads, activeThreadId, views: { ...loadedViews, ...state.views }, threadEpochs });
      rememberSelection(deps, activeThreadId);
      if (activeThreadId && stored.some((thread) => thread.id === activeThreadId)) {
        raise({ type: "REFRESH", threadId: activeThreadId });
      }
      return done();
    }

    case "HYDRATE_FAILED": {
      assign({ lifecycle: "ready" });
      deps.log.error("Thread hydration failed", event.error);
      if (state.threads.length === 0 && !Object.values(state.requests).some((request) => request.kind === "create")) {
        raise({ type: "NEW_THREAD" });
      }
      return done();
    }

    case "APPLY_EVENT": {
      const { envelope } = event;
      if (state.tombstones.has(envelope.threadId)) return done();
      const current = state.views[envelope.threadId] ?? emptyThreadView(envelope.threadId);
      const reduced = reduceThreadEvent(current, envelope);
      if (reduced.needsSnapshot) {
        const buffered = bufferEnvelope(state.recoveryBuffer[envelope.threadId] ?? [], envelope, deps.log);
        assign({
          recoveryBuffer: { ...state.recoveryBuffer, [envelope.threadId]: buffered.events },
          ...(buffered.overflowed
            ? {
                recoveryErrors: {
                  ...state.recoveryErrors,
                  [envelope.threadId]: "Too many events arrived while recovering this thread",
                },
              }
            : {}),
        });
        raise({ type: "REFRESH", threadId: envelope.threadId });
        return done();
      }
      const drained = drainBuffer(reduced.view, state.recoveryBuffer[envelope.threadId] ?? []);
      const recoveryErrors = { ...state.recoveryErrors };
      delete recoveryErrors[envelope.threadId];
      const knownThread = state.threads.some((thread) => thread.id === envelope.threadId);
      const now = Date.now();
      const firstUser = drained.view.timeline.find(
        (item) => item.kind === "message" && item.role === "user" && item.delivery === "applied",
      );
      const threads = knownThread
        ? state.threads.map((thread) =>
            thread.id === envelope.threadId
              ? {
                  ...thread,
                  title:
                    thread.titleOrigin !== "user" && thread.lastSeq === 0 && firstUser?.kind === "message"
                      ? firstUser.content.slice(0, 48)
                      : thread.title,
                  titleOrigin:
                    thread.titleOrigin !== "user" && thread.lastSeq === 0 && firstUser?.kind === "message"
                      ? "message"
                      : thread.titleOrigin,
                  updatedAt: now,
                  phase: drained.view.phase,
                  lastSeq: drained.view.lastSeq,
                }
              : thread,
          )
        : [
            ...state.threads,
            {
              id: envelope.threadId,
              title: firstUser?.kind === "message" ? firstUser.content.slice(0, 48) : NEW_THREAD_TITLE(),
              createdAt: now,
              updatedAt: now,
              phase: drained.view.phase,
              lastSeq: drained.view.lastSeq,
            },
          ];
      assign({
        threads,
        views: { ...state.views, [envelope.threadId]: drained.view },
        recoveryBuffer: { ...state.recoveryBuffer, [envelope.threadId]: drained.remaining },
        recoveryErrors,
        activeThreadId: state.activeThreadId ?? envelope.threadId,
        threadEpochs: knownThread ? state.threadEpochs : { ...state.threadEpochs, [envelope.threadId]: 1 },
      });
      if (drained.needsSnapshot) raise({ type: "REFRESH", threadId: envelope.threadId });
      return done();
    }

    case "NEW_THREAD": {
      const request = newThreadRequest();
      spawn(
        { kind: "create", request },
        {
          kind: "create",
          commandIds: event.deleteCompletion?.commandIds ?? (event.commandId ? [event.commandId] : []),
          threadId: request.id,
          completionResult: event.deleteCompletion?.result,
        },
      );
      return done();
    }

    case "SET_ACTIVE": {
      if (state.tombstones.has(event.id) || !state.threads.some((thread) => thread.id === event.id)) return done();
      assign({ activeThreadId: event.id });
      rememberSelection(deps, event.id);
      raise({ type: "REFRESH", threadId: event.id });
      return done();
    }

    case "RENAME": {
      const title = event.title.trim();
      if (!title || state.tombstones.has(event.id) || !state.threads.some((thread) => thread.id === event.id)) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      spawn(
        { kind: "rename", threadId: event.id, title },
        { kind: "rename", commandIds: [event.commandId], threadId: event.id },
      );
      return done();
    }

    case "CONFIGURE": {
      if (
        state.tombstones.has(event.id) ||
        !state.threads.some((thread) => thread.id === event.id) ||
        (event.patch.accessProfile === undefined && event.patch.reasoningLevel === undefined)
      ) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      spawn(
        { kind: "configure", threadId: event.id, patch: event.patch },
        { kind: "configure", commandIds: [event.commandId], threadId: event.id },
      );
      return done();
    }

    case "BRANCH_PREVIEW": {
      spawn(
        { kind: "branch-preview", threadId: event.threadId },
        { kind: "branch-preview", commandIds: [event.commandId], threadId: event.threadId },
      );
      return done();
    }

    case "BRANCH": {
      const title = event.title.trim();
      if (!title) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "rejected", message: "AI: title is empty" });
        return done();
      }
      spawn(
        { kind: "branch", threadId: event.threadId, checkpointId: event.checkpointId, title },
        { kind: "branch", commandIds: [event.commandId], threadId: event.threadId },
      );
      return done();
    }

    case "COMPACTION_PREVIEW": {
      spawn(
        { kind: "compaction-preview", threadId: event.threadId },
        { kind: "compaction-preview", commandIds: [event.commandId], threadId: event.threadId },
      );
      return done();
    }

    case "COMPACT": {
      spawn(
        {
          kind: "compact",
          threadId: event.threadId,
          revision: event.revision,
          ...(event.instructions ? { instructions: event.instructions } : {}),
        },
        { kind: "compact", commandIds: [event.commandId], threadId: event.threadId },
      );
      return done();
    }

    case "SUBMIT": {
      const content = event.text.trim();
      if (!content) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      const threadId = state.activeThreadId;
      if (!threadId) {
        const request = newThreadRequest();
        spawn(
          { kind: "create", request },
          { kind: "create", commandIds: [], threadId: request.id, pendingSubmit: event },
        );
        return done();
      }
      const id = randomUUID();
      const view = state.views[threadId] ?? emptyThreadView(threadId);
      const request = {
        threadId,
        message: { id, content, createdAt: Date.now() },
        history: messagesFromView(view),
        providerId: event.options?.providerId,
        model: event.options?.model,
        accessProfile: event.options?.accessProfile,
        reasoningLevel: event.options?.reasoningLevel,
        bundle: deps.collectBundle(),
      };
      spawn({ kind: "submit", request }, { kind: "submit", commandIds: [event.commandId], threadId, messageId: id });
      return done();
    }

    case "RESOLVE_APPROVAL": {
      const threadId = state.activeThreadId;
      if (!threadId) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      const view = state.views[threadId];
      if (view) {
        assign({ views: { ...state.views, [threadId]: withApprovalStatus(view, event.approvalId, "resolving") } });
      }
      spawn(
        { kind: "approval", threadId, approvalId: event.approvalId, decision: event.decision },
        { kind: "approval", commandIds: [event.commandId], threadId, approvalId: event.approvalId },
      );
      return done();
    }

    case "REFRESH": {
      const existing = Object.entries(state.requests).find(
        ([, request]) => request.kind === "snapshot" && request.threadId === event.threadId,
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
      if (state.tombstones.has(event.threadId)) {
        if (event.commandId) emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      spawn(
        { kind: "snapshot", threadId: event.threadId },
        {
          kind: "snapshot",
          commandIds: event.commandId ? [event.commandId] : [],
          threadId: event.threadId,
          epoch: threadEpoch(state, event.threadId),
        },
      );
      return done();
    }

    case "CANCEL": {
      const threadId = state.activeThreadId;
      if (!threadId) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      spawn({ kind: "stop", threadId }, { kind: "stop", commandIds: [event.commandId], threadId });
      return done();
    }

    case "DELETE": {
      if (state.tombstones.has(event.id)) {
        emit({ type: "CLIENT.OUTCOME", commandId: event.commandId, status: "resolved" });
        return done();
      }
      const nextEpoch = threadEpoch(state, event.id) + 1;
      assign({
        tombstones: new Set(state.tombstones).add(event.id),
        deletingThreads: new Set(state.deletingThreads).add(event.id),
        threadEpochs: { ...state.threadEpochs, [event.id]: nextEpoch },
      });
      spawn(
        { kind: "delete", threadId: event.id },
        { kind: "delete", commandIds: [event.commandId], threadId: event.id, epoch: nextEpoch },
      );
      return done();
    }

    case "DEV_REPLACE_VIEW": {
      if (
        event.view.threadId !== event.threadId ||
        state.tombstones.has(event.threadId) ||
        !state.threads.some((thread) => thread.id === event.threadId)
      ) {
        return done();
      }
      assign({ views: { ...state.views, [event.threadId]: event.view } });
      return done();
    }

    case "REQUEST_DONE":
      return reduceRequestDone(deps, state, event, { assign, raise, emit, done });

    case "REQUEST_FAILED":
      return reduceRequestFailed(deps, state, event, { assign, raise, emit, done });
  }
}
