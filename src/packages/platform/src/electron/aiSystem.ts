// Electron MAIN caps-assembler for the AI subsystem — the thin shell adapter over the neutral
// AI composition root. It ASSEMBLES the privileged host capabilities from the Electron platform impls (safeStorage
// keychain + 0600 credentials file, node-spawn isolated exec, node:dns, process.env) and provides the Node
// FS/Path ports + the ipcMain transport; all broker wiring lives once in the shared AI host. The Electron surface
// (ipc / safeStorage / app paths / sender guard) is INJECTED by main, so this module imports no `electron`.

import os from "node:os";
import { join } from "node:path";
import { withDevApiKeys } from "@/ai-system/adapters/devKeys";
import type { AIInvokeChannel, AIInvokeResponse, AIPushChannel, AIPushPayload } from "@/ai-system/core/channels";
import type { AISettings, EngineOps } from "@/ai-system/core/types";
import type { AIBroker } from "@/ai-system/host/broker";
import { createAISystem as createSharedAISystem } from "@/ai-system/host/createAISystem";
import { createOmaAgentSession } from "@/ai-system/runtime/omaAgentSession";
import { createOmaGoalRun } from "@/ai-system/runtime/omaGoalRun";
import { createCredentialsFs } from "@/platform/electron/capabilities/credentialsFs";
import { createNodeDnsResolve } from "@/platform/electron/capabilities/dns";
import { createNodeExecuteIsolated } from "@/platform/electron/capabilities/executeIsolated";
import { createNodeKeychain, type SafeStorageLike } from "@/platform/electron/capabilities/keychain";
import { createNodeWorkspaceAccess } from "@/platform/electron/capabilities/workspaceAccess";
import { FS, Path } from "@/platform/electron/host";
import { createElectronProviderTransport } from "@/platform/electron/providerTransport";
import { createElectronPublicWebFetch } from "@/platform/electron/publicWebFetch";

// `TEvent` is Electron's IPC invoke event, kept as a type parameter because this adapter (by design) imports no
// `electron`; `main.ts` — the only electron-importing module — supplies the concrete `IpcMainInvokeEvent`.
export interface AISystemDeps<TEvent = unknown> {
  // OS app-data dir (app.getPath("userData")) — where keys + the AI JSON stores are persisted.
  userDataDir: string;
  // Electron safeStorage (OS keychain) used to encrypt provider keys at rest.
  safeStorage: SafeStorageLike;
  // process.platform — the keychain tunes its degraded-encryption policy from it.
  platform: NodeJS.Platform;
  // IPC transport (Electron ipcMain), injected so this module never imports `electron`.
  onInvoke: <TChannel extends AIInvokeChannel>(
    channel: TChannel,
    handler: (event: TEvent, payload: unknown) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
  ) => void;
  send: <TChannel extends AIPushChannel>(event: TEvent, channel: TChannel, payload: AIPushPayload<TChannel>) => void;
  senderId: (event: TEvent) => number | string;
  isAllowedSender: (event: TEvent) => boolean;
  // Reads + normalizes the persisted AI settings.
  getAISettings: () => Promise<AISettings>;
  // Typed container operations the assistant's first-class tools call. Absent ⇒ only generic tools.
  engineOps?: EngineOps;
  // CONTAINER_DESKTOP_MOCK — swap real streamers/runner/stores for scripted mocks.
  mock?: boolean;
  // DEVELOPMENT-ONLY provider API keys seeded from the environment (e.g. OPENROUTER_API_KEY). Present ONLY in
  // development; when set, a provider with no keychain entry falls back to its env key (a stored key wins).
  devApiKeys?: Record<string, string>;
  logger?: { error: (...args: unknown[]) => void };
}

// Assemble the Electron host capabilities + deps and hand off to the shared composition root.
export async function createAISystem<TEvent = unknown>(deps: AISystemDeps<TEvent>): Promise<AIBroker<TEvent>> {
  const baseKeychain = createNodeKeychain({
    safeStorage: deps.safeStorage,
    fs: createCredentialsFs(join(deps.userDataDir, "ai-credentials.json")),
    platform: deps.platform,
  });
  // DEVELOPMENT-ONLY: fall back to env-seeded provider keys when the keychain has none (inert in prod/testing).
  const keychain =
    deps.devApiKeys && Object.keys(deps.devApiKeys).length > 0
      ? withDevApiKeys(baseKeychain, deps.devApiKeys)
      : baseKeychain;

  // Phase 1 (dev-only, DCE'd from production): under CONTAINER_DESKTOP_MOCK, drive the open-multi-agent engine with a
  // scripted adapter so the owned loop + token streaming can be verified without a provider key.
  const mockEngine =
    deps.mock && import.meta.env.ENVIRONMENT !== "production" ? await import("@/ai-system/testing/omaMocks") : null;

  // The confined workspace (node:fs, MAIN-only). Its root is resolved lazily from AI settings, so the
  // user can change the folder without restarting; every op rejects until a workspace folder is chosen.
  const workspaceAccess = createNodeWorkspaceAccess({
    resolveRoot: async () => (await deps.getAISettings()).workspaceRoot,
    exec: createNodeExecuteIsolated(),
  });

  return createSharedAISystem(
    {
      keychain,
      executeIsolated: createNodeExecuteIsolated(),
      dns: createNodeDnsResolve(),
      // Electron main has the real process environment; the sandbox policy scrubs it to an allowlist.
      env: process.env,
    },
    {
      userDataDir: deps.userDataDir,
      fs: FS,
      path: Path,
      sandboxCwd: os.tmpdir(),
      getAISettings: deps.getAISettings,
      createAgentSession: mockEngine?.createMockOmaAgentSession ?? createOmaAgentSession,
      createGoalRun: mockEngine?.createMockOmaGoalRun ?? createOmaGoalRun,
      onInvoke: deps.onInvoke,
      send: deps.send,
      senderId: deps.senderId,
      isAllowedSender: deps.isAllowedSender,
      providerTransport: createElectronProviderTransport({ keychain }),
      publicWebFetch: createElectronPublicWebFetch(),
      engineOps: deps.engineOps,
      workspaceAccess,
      mock: deps.mock,
      logger: deps.logger,
    },
  );
}
