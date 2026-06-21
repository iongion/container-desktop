// Preload-side forwarder exposed as window.AI. Every method relays to the main AIBroker, which
// enforces the main-window sender guard + the stored-API-key gate for cloud, and owns the provider
// keys (never returned here). CJS-safe: no web-app imports. See.
import { ipcRenderer } from "electron";

import { AI_CHANNELS, type ChatRequest, type GenerateRequest } from "@/ai-system/core";

export const AIClient: IAI = {
  status: () => ipcRenderer.invoke(AI_CHANNELS.status),
  hasKey: (provider: string) => ipcRenderer.invoke(AI_CHANNELS.keyHas, { provider }),
  setKey: (provider: string, key: string, opts?: { allowDegraded?: boolean }) =>
    ipcRenderer.invoke(AI_CHANNELS.keySet, { provider, key, allowDegraded: opts?.allowDegraded }),
  clearKey: (provider: string) => ipcRenderer.invoke(AI_CHANNELS.keyClear, { provider }),
  preview: (payload: unknown) => ipcRenderer.invoke(AI_CHANNELS.preview, { payload }),
  egressCheck: (providerId?: string) => ipcRenderer.invoke(AI_CHANNELS.egressCheck, { providerId }),
  chat: (req: ChatRequest) => ipcRenderer.invoke(AI_CHANNELS.chat, req),
  cancelChat: (streamId: string) => ipcRenderer.send(AI_CHANNELS.chatCancel, { streamId }),
  // Fire-and-forget: the broker runs/persists per mode and resumes the turn over the stream.
  resolve: (streamId, actionId, decision) =>
    ipcRenderer.send(AI_CHANNELS.agentResolve, { streamId, actionId, decision }),
  generate: (req: GenerateRequest) => ipcRenderer.invoke(AI_CHANNELS.generate, req),
  listModels: (providerId?: string) => ipcRenderer.invoke(AI_CHANNELS.modelsList, { providerId }),
  // The user-managed allow/reject record — managed from Settings → AI permissions.
  listPermissions: () => ipcRenderer.invoke(AI_CHANNELS.permissionsList),
  removePermission: (list, key) => ipcRenderer.invoke(AI_CHANNELS.permissionsRemove, { list, key }),
  setWebPermission: (verdict) => ipcRenderer.invoke(AI_CHANNELS.permissionsSetWeb, { verdict }),
};
