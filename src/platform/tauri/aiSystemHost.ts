// In-webview AI hub for the Tauri realm — the AI analog of resourceSyncHost.ts. Under Tauri the AIBroker runs in
// the SAME realm as the UI (no separate main process), so the Electron main↔renderer AI IPC collapses to direct
// calls: aiSystem.ts builds + registers the SHARED AIBroker against the shared in-realm bus
// (createInRealmBus) instead of ipcMain/ipcRenderer, and this module exposes the SAME typed window.AI /
// window.AIBus surface (via the shared aiClientBridge) the renderer already reads. Tauri-agnostic (no
// @tauri-apps imports) so it stays unit-testable; bridge.ts ties it to the real invoke + engineOps.

import type { IAI, IAIBus } from "@/ai-system/core";
import type { IFileSystem, IPath } from "@/platform/contract";
import type { TauriInvoke } from "@/platform/tauri/capabilities/invoke";
import { createTauriAIBus } from "./aiBus";
import { createTauriAIClient } from "./aiClient";
import { type AISystemDeps, createAISystem } from "./aiSystem";
import { createInRealmBus } from "./inRealmBus";

export interface AISystemHost {
  ai: IAI;
  aiBus: IAIBus;
  dispose(): void;
}

export interface AISystemHostDeps {
  invoke: TauriInvoke;
  fs: IFileSystem;
  path: IPath;
  userDataDir: string;
  getAISettings: AISystemDeps["getAISettings"];
  engineOps?: AISystemDeps["engineOps"];
  mock?: boolean;
  logger?: { error: (...args: any[]) => void };
}

export async function createAISystemHost(deps: AISystemHostDeps): Promise<AISystemHost> {
  const bus = createInRealmBus();

  const broker = await createAISystem({
    invoke: deps.invoke,
    fs: deps.fs,
    path: deps.path,
    userDataDir: deps.userDataDir,
    getAISettings: deps.getAISettings,
    engineOps: deps.engineOps,
    mock: deps.mock,
    onInvoke: bus.onInvoke,
    onMessage: bus.onMessage,
    // The broker's send is (event, channel, payload); the bus dispatch is event-agnostic (one webview).
    send: (_event, channel, payload) => bus.dispatch(channel, payload),
    senderId: bus.senderId,
    isAllowedSender: bus.isAllowedSender,
    logger: deps.logger,
  });

  // The SAME typed window.AI / window.AIBus surface the renderer reads; the named Tauri client/bus modules
  // mirror platform/electron/aiClient.ts and platform/electron/aiBus.ts.
  const ai = createTauriAIClient(bus);
  const aiBus = createTauriAIBus(bus);

  return {
    ai,
    aiBus,
    dispose: () => {
      broker.disposeForSender(1);
      bus.clear();
    },
  };
}
