// Electron MAIN composition root for the AI subsystem. The ONE place that assembles the
// electron-free pieces — core contracts, the host broker, and the Node runtime implementations — into a
// wired, registered AIBroker. The Electron surface (ipcMain transport, safeStorage, app paths, the
// main-window sender guard) is INJECTED, so this module imports no `electron`: a different shell (e.g.
// Tauri) reuses host + runtimes/node and writes its own thin composition root with the same shape.

import path from "node:path";

import type { AISettings, EngineOps } from "@/ai-system/core";
import { AIBroker } from "@/ai-system/host/broker";
import { KnowledgeBank } from "@/ai-system/host/knowledgeBank";
import { buildAgentPrompt, buildGeneratePrompt } from "@/ai-system/prompt/prompts";
import { createAgentRunner } from "@/ai-system/runtimes/node/agent/agent";
import { executeContainerTool } from "@/ai-system/runtimes/node/agent/containerTools";
import { executeSandboxed } from "@/ai-system/runtimes/node/agent/sandbox";
import { createSandboxExec } from "@/ai-system/runtimes/node/agent/sandboxExec";
import { createAgentTools } from "@/ai-system/runtimes/node/agent/tools";
import { webSearch } from "@/ai-system/runtimes/node/agent/webSearch";
import { createCredentialsFs } from "@/ai-system/runtimes/node/credentialsStore";
import { withDevApiKeys } from "@/ai-system/runtimes/node/devKeys";
import { createAIKeyStore, type SafeStorageLike } from "@/ai-system/runtimes/node/keyStore";
import { createFileKnowledgeStorage } from "@/ai-system/runtimes/node/knowledgeFileStorage";
import { listModels } from "@/ai-system/runtimes/node/localModels";
import { createPermissionsStore } from "@/ai-system/runtimes/node/permissionsStore";
import "@/ai-system/prompt/templateRegistry.vite";
import { createMockAIDeps } from "@/ai-system/testing/aiMocks";

export interface ElectronAISystemDeps {
  /** OS app-data dir (app.getPath("userData")) — where keys + the knowledge bank are persisted. */
  userDataDir: string;
  /** Electron safeStorage (OS keychain) used to encrypt provider keys at rest. */
  safeStorage: SafeStorageLike;
  /** process.platform — keyStore tunes its degraded-encryption policy from it. */
  platform: NodeJS.Platform;
  // IPC transport (Electron ipcMain), injected so this module never imports `electron`.
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  send: (event: any, channel: string, payload: unknown) => void;
  senderId: (event: any) => number | string;
  isAllowedSender: (event: any) => boolean;
  /** Reads + normalizes the persisted AI settings. */
  getAISettings: () => Promise<AISettings>;
  /** Typed container operations the assistant's first-class tools call (built over EngineDataService in
   *  main.ts). Absent ⇒ only the generic command/web/knowledge tools are offered. */
  engineOps?: EngineOps;
  /** CONTAINER_DESKTOP_MOCK — swap real streamers/runner/stores for scripted mocks. */
  mock?: boolean;
  /** DEVELOPMENT-ONLY: provider API keys seeded from the environment (e.g. OPENROUTER_API_KEY). The main
   *  composition root supplies this ONLY in development — never in production or the testing stage. When
   *  present, a provider with no keychain entry falls back to its env key (a stored key still wins). */
  devApiKeys?: Record<string, string>;
  logger?: { error: (...args: any[]) => void };
}

// Build, register, and return the AI broker. The caller keeps the handle to reap streams on window close.
export function createElectronAISystem(deps: ElectronAISystemDeps): AIBroker {
  // One mock instance shared across every dep when CONTAINER_DESKTOP_MOCK is set.
  const mocks = deps.mock ? createMockAIDeps() : null;

  const sandboxExec = createSandboxExec();
  // The user-managed allow/reject record (broker-owned writes). Always real, even in mock mode, so the
  // Settings → AI permissions UI is exercisable in `CONTAINER_DESKTOP_MOCK=1 yarn dev`.
  const permissionsStore = createPermissionsStore(path.join(deps.userDataDir, "ai-permissions.json"));
  const knowledgeBank = new KnowledgeBank({
    storage: createFileKnowledgeStorage(path.join(deps.userDataDir, "ai-knowledge.json")),
  });
  void knowledgeBank.init().catch((error) => deps.logger?.error("AI knowledge bank init failed", error));

  const baseKeyStore = createAIKeyStore({
    safeStorage: deps.safeStorage,
    fs: createCredentialsFs(path.join(deps.userDataDir, "ai-credentials.json")),
    platform: deps.platform,
  });
  // Mock mode: a mock keyStore reports every provider as configured, so cloud catalogs (e.g. OpenRouter's
  // vendor-prefixed list) are browsable + connection-testable without a real key. Otherwise DEVELOPMENT-ONLY:
  // fall back to env-seeded provider keys (e.g. OPENROUTER_API_KEY) when the keychain has none, so a non-mock
  // `yarn dev` reaches real clouds. devApiKeys is empty/absent in prod + testing.
  const keyStore = mocks
    ? mocks.keyStore
    : deps.devApiKeys && Object.keys(deps.devApiKeys).length > 0
      ? withDevApiKeys(baseKeyStore, deps.devApiKeys)
      : baseKeyStore;

  // The typed engine surface the assistant's first-class tools call (and the broker re-runs on approval).
  const engineOps = mocks ? mocks.engineOps : deps.engineOps;

  const broker = new AIBroker({
    keyStore,
    getAISettings: deps.getAISettings,
    onInvoke: deps.onInvoke,
    onMessage: deps.onMessage,
    send: deps.send,
    senderId: deps.senderId,
    isAllowedSender: deps.isAllowedSender,
    listModels: mocks
      ? (baseURL, opts) => mocks.listModels(baseURL, opts)
      : (baseURL, opts) => listModels(baseURL, opts),
    agentRunner: mocks ? mocks.agentRunner : createAgentRunner(),
    runSandboxed: mocks
      ? (cmd, opts) => mocks.runSandboxed(cmd, opts)
      : (cmd, opts) => executeSandboxed(cmd, { exec: sandboxExec, enforceFloor: opts?.enforceFloor }),
    buildAgentTools: createAgentTools,
    engineOps,
    runEngineTool: engineOps ? (name, args) => executeContainerTool(engineOps, name, args) : undefined,
    permissionsStore,
    knowledgeBank: mocks ? mocks.knowledgeBank : knowledgeBank,
    webSearcher: mocks
      ? (query) => mocks.webSearcher(query)
      : (query) => webSearch(query).then((r) => ({ text: r.text })),
    buildGeneratePrompt,
    buildAgentPrompt,
    logger: deps.logger,
  });
  broker.register();
  return broker;
}
