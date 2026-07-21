import { createMockCommand } from "@/container-client/mock/MockCommand";
import { isMockMode } from "@/container-client/mock/mode";
import { parseRemoteConnectionsEnv } from "@/container-client/remote-env";
import { ActivityBus, wrapCommandForActivity } from "@/platform/activityBus";
import { AIBus } from "@/platform/electron/aiBus";
import { AIClient } from "@/platform/electron/aiClient";
import { Command } from "@/platform/electron/command";
import { forwardProxyRequest } from "@/platform/electron/commandProxyClient";
import { CURRENT_DARWIN_MAJOR, CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/electron/host";
import { MessageBus } from "@/platform/electron/messageBus";
import { ResourceBus } from "@/platform/electron/resourceBus";
import { TrayBus } from "@/platform/electron/trayBus";
import { installPlatformGlobals } from "@/platform/globals";

export interface ElectronHostBridgeDeps {
  exposeInMainWorld: (name: string, value: unknown) => void;
  target?: typeof globalThis;
  env?: NodeJS.ProcessEnv;
}

export function installElectronHostBridge(deps: ElectronHostBridgeDeps): void {
  const env = deps.env ?? process.env;
  const target = deps.target ?? global;

  // Wrap Command BEFORE exposing it so every renderer-initiated CLI call is captured for the Activity Log,
  // then forward ProxyRequest to MAIN so the single engine connection (tunnel / relay / socket pool) lives
  // only there. The CLI/SSH methods stay local (one-shot, no persistent connection). This composed instance
  // is what both the global patch and the renderer see.
  const BaseCommand = isMockMode() ? createMockCommand() : Command;
  const ActivityCommand = wrapCommandForActivity(BaseCommand);
  const ForwardingCommand: ICommand = isMockMode()
    ? ActivityCommand
    : { ...ActivityCommand, ProxyRequest: forwardProxyRequest };

  // Patch the shared platform globals (the same set main installs); preload adds the receive buses.
  installPlatformGlobals(target, {
    command: ForwardingCommand,
    platform: Platform,
    path: Path,
    fs: FS,
    osType: CURRENT_OS_TYPE,
    darwinMajor: CURRENT_DARWIN_MAJOR,
    messageBus: MessageBus,
    extras: { TrayBus, ResourceBus, AI: AIClient, AIBus },
  });

  deps.exposeInMainWorld("Command", ForwardingCommand);
  deps.exposeInMainWorld("Platform", Platform);
  deps.exposeInMainWorld("Path", Path);
  deps.exposeInMainWorld("FS", FS);
  deps.exposeInMainWorld("CURRENT_OS_TYPE", CURRENT_OS_TYPE);
  deps.exposeInMainWorld("CURRENT_DARWIN_MAJOR", CURRENT_DARWIN_MAJOR);
  deps.exposeInMainWorld("MessageBus", MessageBus);
  deps.exposeInMainWorld("ActivityBus", ActivityBus);
  deps.exposeInMainWorld("TrayBus", TrayBus);
  deps.exposeInMainWorld("ResourceBus", ResourceBus);
  deps.exposeInMainWorld("AI", AIClient);
  deps.exposeInMainWorld("AIBus", AIBus);
  deps.exposeInMainWorld("CONTAINER_DESKTOP_MOCK", env.CONTAINER_DESKTOP_MOCK ?? "");
  // The renderer has no `process`, so hand it the LIVE log level (preload runs before renderer scripts).
  // This lets CONTAINER_DESKTOP_LOG_LEVEL change the renderer level at launch without a rebuild — the
  // build-time vite define is only a fallback. See logger/index.ts → getEnvironmentLogLevel.
  deps.exposeInMainWorld("CONTAINER_DESKTOP_LOG_LEVEL", env.CONTAINER_DESKTOP_LOG_LEVEL ?? "");
  // Dev-only: the renderer has no `process`, so hand it the parsed env-driven remote connections to seed
  // (see container-client/remote-env.ts → resolveRemoteEnvConnections).
  deps.exposeInMainWorld("CONTAINER_DESKTOP_REMOTE_CONNECTIONS", JSON.stringify(parseRemoteConnectionsEnv(env)));
  deps.exposeInMainWorld("Preloaded", true);
}
