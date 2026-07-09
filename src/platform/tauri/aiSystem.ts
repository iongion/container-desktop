// Tauri (webview-realm) caps-assembler for the AI subsystem — the thin shell adapter over the neutral
// AI composition root, mirroring platform/electron/aiSystem.ts. It ASSEMBLES the privileged host
// capabilities from the Tauri platform impls (OS-keychain / env-isolating exec / DNS over `invoke`) and provides
// the window.FS/Path ports + the in-webview transport; all broker wiring lives once in the shared AI host. The IPC
// transport is injected (aiSystemHost provides an in-webview bus), so this module never imports @tauri-apps.

import type { AISettings, EngineOps } from "@/ai-system/core";
import type { AIBroker } from "@/ai-system/host/broker";
import { createAISystem as createSharedAISystem } from "@/ai-system/host/createAISystem";
import type { IFileSystem, IPath } from "@/platform/contract";
import { createTauriDnsResolve } from "@/platform/tauri/capabilities/dns";
import { createTauriExecuteIsolated } from "@/platform/tauri/capabilities/executeIsolated";
import type { TauriInvoke } from "@/platform/tauri/capabilities/invoke";
import { createTauriKeychain } from "@/platform/tauri/capabilities/keychain";

export interface AISystemDeps {
  // Tauri `invoke` — reaches the keychain_*, command_execute, dns_lookup host commands.
  invoke: TauriInvoke;
  // The app FileSystem + Path ports (window.FS / window.Path) for the permission + knowledge JSON stores.
  fs: IFileSystem;
  path: IPath;
  // userData dir — where the AI JSON stores live and the sandbox cwd is rooted.
  userDataDir: string;
  // Reads + normalizes the persisted AI settings (bridge sources it from the app config).
  getAISettings: () => Promise<AISettings>;
  // Typed container operations the assistant's first-class tools call (over the in-webview EngineDataService).
  engineOps?: EngineOps;
  // CONTAINER_DESKTOP_MOCK — swap real streamers/runner/stores for scripted mocks.
  mock?: boolean;
  // Injected in-webview IPC transport (aiSystemHost) — the AIBroker's process-neutral 5-function shape.
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  send: (event: any, channel: string, payload: unknown) => void;
  senderId: (event: any) => number | string;
  isAllowedSender: (event: any) => boolean;
  logger?: { error: (...args: any[]) => void };
}

// Assemble the Tauri host capabilities + deps and hand off to the shared composition root. Async because the
// keychain probes the OS vault once at construction (so its getEncryptionStatus() can stay synchronous).
export async function createAISystem(deps: AISystemDeps): Promise<AIBroker> {
  return createSharedAISystem(
    {
      keychain: await createTauriKeychain(deps.invoke),
      executeIsolated: createTauriExecuteIsolated(deps.invoke),
      dns: createTauriDnsResolve(deps.invoke),
      // No ambient process environment in the webview — command_execute(isolate=true) owns the child's real env.
      env: {},
    },
    {
      userDataDir: deps.userDataDir,
      fs: deps.fs,
      path: deps.path,
      sandboxCwd: deps.userDataDir,
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
