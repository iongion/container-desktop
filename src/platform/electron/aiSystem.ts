// Electron MAIN caps-assembler for the AI subsystem — the thin shell adapter over the neutral
// AI composition root. It ASSEMBLES the privileged host capabilities from the Electron platform impls (safeStorage
// keychain + 0600 credentials file, node-spawn isolated exec, node:dns, process.env) and provides the Node
// FS/Path ports + the ipcMain transport; all broker wiring lives once in the shared AI host. The Electron surface
// (ipc / safeStorage / app paths / sender guard) is INJECTED by main, so this module imports no `electron`.

import os from "node:os";
import { join } from "node:path";

import type { AISettings, EngineOps } from "@/ai-system/core";
import type { AIBroker } from "@/ai-system/host/broker";
import { createAISystem as createSharedAISystem } from "@/ai-system/host/createAISystem";
import { withDevApiKeys } from "@/ai-system/runtimes/devKeys";
import { createCredentialsFs } from "@/platform/electron/capabilities/credentialsFs";
import { createNodeDnsResolve } from "@/platform/electron/capabilities/dns";
import { createNodeExecuteIsolated } from "@/platform/electron/capabilities/executeIsolated";
import { createNodeKeychain, type SafeStorageLike } from "@/platform/electron/capabilities/keychain";
import { FS, Path } from "@/platform/electron/host";

export interface AISystemDeps {
  /** OS app-data dir (app.getPath("userData")) — where keys + the AI JSON stores are persisted. */
  userDataDir: string;
  /** Electron safeStorage (OS keychain) used to encrypt provider keys at rest. */
  safeStorage: SafeStorageLike;
  /** process.platform — the keychain tunes its degraded-encryption policy from it. */
  platform: NodeJS.Platform;
  // IPC transport (Electron ipcMain), injected so this module never imports `electron`.
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  send: (event: any, channel: string, payload: unknown) => void;
  senderId: (event: any) => number | string;
  isAllowedSender: (event: any) => boolean;
  /** Reads + normalizes the persisted AI settings. */
  getAISettings: () => Promise<AISettings>;
  /** Typed container operations the assistant's first-class tools call. Absent ⇒ only generic tools. */
  engineOps?: EngineOps;
  /** CONTAINER_DESKTOP_MOCK — swap real streamers/runner/stores for scripted mocks. */
  mock?: boolean;
  /** DEVELOPMENT-ONLY provider API keys seeded from the environment (e.g. OPENROUTER_API_KEY). Present ONLY in
   *  development; when set, a provider with no keychain entry falls back to its env key (a stored key wins). */
  devApiKeys?: Record<string, string>;
  logger?: { error: (...args: any[]) => void };
}

// Assemble the Electron host capabilities + deps and hand off to the shared composition root.
export function createAISystem(deps: AISystemDeps): Promise<AIBroker> {
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
      onInvoke: deps.onInvoke,
      onMessage: deps.onMessage,
      send: deps.send,
      senderId: deps.senderId,
      isAllowedSender: deps.isAllowedSender,
      engineOps: deps.engineOps,
      mock: deps.mock,
      logger: deps.logger,
    },
  );
}
