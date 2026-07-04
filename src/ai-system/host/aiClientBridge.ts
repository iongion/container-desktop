// The ONE mapping of the typed AI client surface (IAI / IAIBus) ↔ the broker's AI_CHANNELS protocol. Both shells
// expose window.AI / window.AIBus from here, injecting only their transport primitive: Electron relays over
// ipcRenderer (preload), Tauri dispatches to the in-webview broker handlers. The shell-specific aiClient.ts /
// aiBus.ts modules stay thin and parallel by construction. Neutral: no electron/@tauri-apps here.

import { AI_CHANNELS, type IAI, type IAIBus } from "@/ai-system/core";

// The request/fire-and-forget pair a shell provides. `invoke` awaits a broker reply; `send` is fire-and-forget.
export interface AIClientTransport {
  invoke: (channel: string, payload?: any) => Promise<any>;
  send: (channel: string, payload?: any) => void;
}

export function createAIClient(transport: AIClientTransport): IAI {
  const { invoke, send } = transport;
  return {
    status: () => invoke(AI_CHANNELS.status),
    hasKey: (provider) => invoke(AI_CHANNELS.keyHas, { provider }),
    setKey: (provider, key, opts) => invoke(AI_CHANNELS.keySet, { provider, key, allowDegraded: opts?.allowDegraded }),
    clearKey: (provider) => invoke(AI_CHANNELS.keyClear, { provider }),
    preview: (payload) => invoke(AI_CHANNELS.preview, { payload }),
    egressCheck: (providerId) => invoke(AI_CHANNELS.egressCheck, { providerId }),
    chat: (req) => invoke(AI_CHANNELS.chat, req),
    cancelChat: (streamId) => send(AI_CHANNELS.chatCancel, { streamId }),
    // Fire-and-forget: the broker runs/persists per mode and resumes the turn over the stream.
    resolve: (streamId, actionId, decision) => send(AI_CHANNELS.agentResolve, { streamId, actionId, decision }),
    generate: (req) => invoke(AI_CHANNELS.generate, req),
    listModels: (providerId) => invoke(AI_CHANNELS.modelsList, { providerId }),
    // The user-managed allow/reject record — managed from Settings → AI permissions.
    listPermissions: () => invoke(AI_CHANNELS.permissionsList),
    removePermission: (list, key) => invoke(AI_CHANNELS.permissionsRemove, { list, key }),
    setWebPermission: (verdict) => invoke(AI_CHANNELS.permissionsSetWeb, { verdict }),
  };
}

// The receive side. A shell provides a raw channel subscription; this enforces the allowlist (only the streamed
// AI push channel is subscribable, mirroring the resource bus) so a renderer can't attach to arbitrary channels.
export interface AIBusTransport {
  subscribe: (channel: string, listener: (payload: any) => void) => () => void;
}

export function createAIBus(transport: AIBusTransport): IAIBus {
  const SUBSCRIBABLE = new Set<string>([AI_CHANNELS.streamEvent]);
  return {
    subscribe(channel, callback) {
      if (!SUBSCRIBABLE.has(channel)) {
        throw new Error(`AIBus: subscribe not allowed for channel "${channel}"`);
      }
      // A throwing subscriber must never break delivery — wrap once, centrally, for both shells.
      const safe = (payload: any) => {
        try {
          callback(payload);
        } catch {
          // swallow — matches resourceBus.ts
        }
      };
      return transport.subscribe(channel, safe);
    },
  };
}
