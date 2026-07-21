// The chat-client runtime: the effect executor around the pure `chatClientReducer`. It owns the non-reentrant FIFO
// dispatcher (a `send` inside an effect enqueues, never recursively reduces — preserving ordering across user
// commands, bus deltas, request completions, and raised follow-ups), the task registry that runs each host request
// and feeds its resolution back as REQUEST_DONE / REQUEST_FAILED, the one-shot hydration load, and the bus
// subscription. `aiStore` wraps this with Zustand + command↔Promise correlation; tests drive it directly.

import {
  type AIStoreDeps,
  type ChatClientEvent,
  type ChatClientState,
  type ClientCommandOutcome,
  type ClientRequestInput,
  chatClientReducer,
  initialChatClientState,
  runRequest,
} from "./chatClientReducer";

export interface ChatClientRuntimeHooks {
  onChange: (state: ChatClientState) => void;
  onOutcome: (outcome: ClientCommandOutcome) => void;
}

export interface ChatClientRuntime {
  getState: () => ChatClientState;
  send: (event: ChatClientEvent) => void;
  dispose: () => void;
}

export function createChatClientRuntime(deps: AIStoreDeps, hooks: ChatClientRuntimeHooks): ChatClientRuntime {
  let state = initialChatClientState();
  let draining = false;
  let disposed = false;
  const queue: ChatClientEvent[] = [];

  const runHostRequest = (requestId: string, input: ClientRequestInput) => {
    runRequest(deps, input).then(
      (output) => send({ type: "REQUEST_DONE", requestId, output }),
      (error) => send({ type: "REQUEST_FAILED", requestId, error }),
    );
  };

  const send = (event: ChatClientEvent) => {
    if (disposed) return;
    queue.push(event);
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const current = queue.shift() as ChatClientEvent;
        const result = chatClientReducer(deps, state, current);
        state = result.state;
        for (const effect of result.effects) {
          if (effect.type === "raise") queue.push(effect.event);
          else if (effect.type === "request") runHostRequest(effect.requestId, effect.input);
          else hooks.onOutcome(effect.outcome);
        }
      }
    } finally {
      draining = false;
    }
    hooks.onChange(state);
  };

  const unsubscribe = deps.subscribeEvents?.((envelope) => send({ type: "APPLY_EVENT", envelope })) ?? (() => {});

  deps
    .getAI()
    .listChats()
    .then(
      (sessions) => send({ type: "HYDRATE_DONE", sessions }),
      (error) => send({ type: "HYDRATE_FAILED", error }),
    );

  return {
    getState: () => state,
    send,
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}
