// Renderer state for the ONE always-agentic assistant. VANILLA Zustand store — no React,
// no `window`. It owns a single seq-ordered timeline per session (prose + tool steps + approval cards,
// appended in arrival order) so resumed turns never misorder. Bridge access (IAI/IAIBus), logging, and
// the diagnostics-bundle collector are injected so the store is testable and framework-agnostic.

import { createStore } from "zustand/vanilla";

import type { AgentStreamEvent, ChatSession, DiagnosticsBundle, ResolveDecision } from "@/ai-system/core";
import { AI_CHANNELS, getChatStore } from "@/ai-system/core";
import {
  hasPendingApproval,
  itemsFromMessages,
  messagesFromItems,
  reduceStreamEvent,
  setApprovalStatus,
  type TranscriptItem,
  userMessageItem,
} from "../transcript";

const uid = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

export interface AIStoreDeps {
  /** Preload bridge — a getter for window.AI, evaluated at call time so tests can swap it. */
  getAI: () => IAI;
  /** Logging — injected so core never imports @/logger. */
  log: { error: (...args: any[]) => void };
  /** Best-effort live engine/diagnostics context from the app layer. Called fresh each turn. */
  collectBundle: () => DiagnosticsBundle;
}

export interface AIState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  /** sessionId → the ordered render timeline (the source of truth for the screen). */
  timelines: Record<string, TranscriptItem[]>;
  /** streamId → sessionId (multiplexes main's pushes back to the right conversation). */
  binding: Record<string, string>;
  /** sessionId → its in-flight streamId (resolve/cancel target). */
  streamBySession: Record<string, string>;
  /** sessionId → whether the model is currently producing (drives the composer send/stop). */
  busy: Record<string, boolean>;
  newSession: () => void;
  setActiveSession: (id: string) => void;
  loadFromStore: () => Promise<void>;
  sendMessage: (text: string, opts?: { providerId?: string; model?: string }) => Promise<void>;
  applyStreamEvent: (evt: AgentStreamEvent) => void;
  resolveApproval: (actionId: string, decision: ResolveDecision) => void;
  cancel: () => void;
}

export function createAIStore(deps: AIStoreDeps) {
  const { getAI, log, collectBundle } = deps;

  return createStore<AIState>((set, get) => {
    const persist = (sessionId: string) => {
      const session = get().sessions.find((x) => x.id === sessionId);
      if (!session) {
        return;
      }
      const messages = messagesFromItems(get().timelines[sessionId] ?? []);
      const title = session.title === "New chat" && messages[0] ? messages[0].content.slice(0, 48) : session.title;
      const updated: ChatSession = { ...session, title, updatedAt: Date.now(), messages };
      set((s) => ({ sessions: s.sessions.map((x) => (x.id === sessionId ? updated : x)) }));
      void getChatStore().saveSession(updated);
    };

    return {
      sessions: [],
      activeSessionId: null,
      timelines: {},
      binding: {},
      streamBySession: {},
      busy: {},

      newSession: () => {
        const now = Date.now();
        const session: ChatSession = { id: uid(), title: "New chat", createdAt: now, updatedAt: now, messages: [] };
        set((s) => ({
          sessions: [...s.sessions, session],
          activeSessionId: session.id,
          timelines: { ...s.timelines, [session.id]: [] },
        }));
        void getChatStore().saveSession(session);
      },

      setActiveSession: (id) => set({ activeSessionId: id }),

      loadFromStore: async () => {
        const sessions = await getChatStore().loadSessions();
        const timelines: Record<string, TranscriptItem[]> = {};
        for (const s of sessions) {
          timelines[s.id] = itemsFromMessages(s.messages);
        }
        set({ sessions, activeSessionId: sessions.at(-1)?.id ?? null, timelines });
      },

      sendMessage: async (text, opts) => {
        const trimmed = text.trim();
        if (!trimmed) {
          return;
        }
        let sessionId = get().activeSessionId;
        if (!sessionId) {
          get().newSession();
          sessionId = get().activeSessionId as string;
        }
        const sid = sessionId;
        set((s) => ({
          timelines: { ...s.timelines, [sid]: [...(s.timelines[sid] ?? []), userMessageItem(uid(), trimmed)] },
          busy: { ...s.busy, [sid]: true },
        }));
        persist(sid);
        const messages = messagesFromItems(get().timelines[sid] ?? []);
        try {
          const { streamId } = await getAI().chat({
            sessionId: sid,
            messages,
            providerId: opts?.providerId,
            model: opts?.model,
            bundle: collectBundle(),
          });
          set((s) => ({
            binding: { ...s.binding, [streamId]: sid },
            streamBySession: { ...s.streamBySession, [sid]: streamId },
          }));
        } catch (error: any) {
          log.error("chat failed", error);
          set((s) => ({
            timelines: {
              ...s.timelines,
              [sid]: [
                ...(s.timelines[sid] ?? []),
                { kind: "error", id: uid(), message: error?.message ?? String(error) },
              ],
            },
            busy: { ...s.busy, [sid]: false },
          }));
        }
      },

      applyStreamEvent: (evt) => {
        const sid = get().binding[evt.streamId];
        if (!sid) {
          return; // not ours — ignore (multiplexing)
        }
        set((s) => ({ timelines: { ...s.timelines, [sid]: reduceStreamEvent(s.timelines[sid] ?? [], evt, uid) } }));
        if (evt.type === "done" || evt.type === "error") {
          set((s) => ({ busy: { ...s.busy, [sid]: false } }));
          persist(sid);
          // Keep the binding alive while an approval is pending (the resume reuses this streamId); else reap.
          if (!hasPendingApproval(get().timelines[sid] ?? [])) {
            set((s) => {
              const binding = { ...s.binding };
              delete binding[evt.streamId];
              const streamBySession = { ...s.streamBySession };
              delete streamBySession[sid];
              return { binding, streamBySession };
            });
          }
        }
      },

      resolveApproval: (actionId, decision) => {
        const sid = get().activeSessionId;
        if (!sid) {
          return;
        }
        const streamId = get().streamBySession[sid];
        if (!streamId) {
          return;
        }
        const status = decision === "allow" ? "allowed" : "rejected";
        set((s) => ({
          timelines: { ...s.timelines, [sid]: setApprovalStatus(s.timelines[sid] ?? [], actionId, status) },
          busy: { ...s.busy, [sid]: true }, // the broker resumes the turn over the same stream
        }));
        getAI().resolve(streamId, actionId, decision);
      },

      cancel: () => {
        const sid = get().activeSessionId;
        if (!sid) {
          return;
        }
        const streamId = get().streamBySession[sid];
        if (streamId) {
          getAI().cancelChat(streamId);
        }
        set((s) => ({ busy: { ...s.busy, [sid]: false } }));
      },
    };
  });
}

// Subscribe ONCE to main's pushes. Call this from the React layer after the store is created.
let subscribed = false;
export function startAIBus(store: ReturnType<typeof createAIStore>, aiBus: IAIBus): void {
  if (subscribed) {
    return;
  }
  subscribed = true;
  aiBus.subscribe(AI_CHANNELS.streamEvent, (evt: AgentStreamEvent) => store.getState().applyStreamEvent(evt));
}
