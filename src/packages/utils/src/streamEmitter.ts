// Shared factory for the on/off/removeListener/destroy/close surface that engine API stream
// consumers (Api.clients, EngineDataService, commandProxyClient) expect. The caller drives the
// returned `emitter` from its own source (a Node stream, IPC chunk events, fixed fixtures, …) and
// keeps its own event mapping; this only standardizes the consumer surface and teardown semantics.
// CJS-safe: depends solely on eventemitter3 (no Electron, no web-app imports).

import { EventEmitter } from "eventemitter3";

export interface EmitterStream {
  on: (event: string, listener: (...args: any[]) => void) => EmitterStream;
  off: (event: string, listener: (...args: any[]) => void) => EmitterStream;
  removeListener: (event: string, listener: (...args: any[]) => void) => EmitterStream;
  destroy: () => void;
  close: () => void;
}

export function createEmitterStream(opts?: { onDestroy?: () => void }): {
  emitter: EventEmitter;
  api: EmitterStream;
} {
  const emitter = new EventEmitter();
  let closed = false;
  const api: EmitterStream = {
    on: (event, listener) => {
      emitter.on(event, listener);
      return api;
    },
    off: (event, listener) => {
      emitter.off(event, listener);
      return api;
    },
    removeListener: (event, listener) => {
      emitter.removeListener(event, listener);
      return api;
    },
    destroy: () => {
      if (closed) {
        return;
      }
      closed = true;
      opts?.onDestroy?.();
      emitter.removeAllListeners();
    },
    close: () => {
      api.destroy();
    },
  };
  return { emitter, api };
}
