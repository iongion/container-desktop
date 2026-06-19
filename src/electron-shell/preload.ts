import { contextBridge } from "electron";

import { createMockCommand } from "@/container-client/mock/MockCommand";
import { isMockMode } from "@/container-client/mock/mode";
import { parseRemoteConnectionsEnv } from "@/container-client/remote-env";
import { CURRENT_DARWIN_MAJOR, CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/node";
import { Command } from "@/platform/node-executor";
import { ActivityBus, wrapCommandForActivity } from "./activityBus";
import { forwardProxyRequest } from "./commandProxyClient";
import { installPlatformGlobals } from "./globals";
import { ResourceBus } from "./resourceBus";
import { MessageBus } from "./shared";
import { TrayBus } from "./trayBus";

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
installPlatformGlobals(global, {
  command: ForwardingCommand,
  messageBus: MessageBus,
  extras: { TrayBus, ResourceBus },
});

function main() {
  contextBridge.exposeInMainWorld("Command", ForwardingCommand);
  contextBridge.exposeInMainWorld("Platform", Platform);
  contextBridge.exposeInMainWorld("Path", Path);
  contextBridge.exposeInMainWorld("FS", FS);
  contextBridge.exposeInMainWorld("CURRENT_OS_TYPE", CURRENT_OS_TYPE);
  contextBridge.exposeInMainWorld("CURRENT_DARWIN_MAJOR", CURRENT_DARWIN_MAJOR);
  contextBridge.exposeInMainWorld("MessageBus", MessageBus);
  contextBridge.exposeInMainWorld("ActivityBus", ActivityBus);
  contextBridge.exposeInMainWorld("TrayBus", TrayBus);
  contextBridge.exposeInMainWorld("ResourceBus", ResourceBus);
  contextBridge.exposeInMainWorld("CONTAINER_DESKTOP_MOCK", process.env.CONTAINER_DESKTOP_MOCK ?? "");
  // Dev-only: the renderer has no `process`, so hand it the parsed env-driven remote connections to seed
  // (see container-client/remote-env.ts → resolveRemoteEnvConnections).
  contextBridge.exposeInMainWorld(
    "CONTAINER_DESKTOP_REMOTE_CONNECTIONS",
    JSON.stringify(parseRemoteConnectionsEnv(process.env)),
  );
  contextBridge.exposeInMainWorld("Preloaded", true);
}

main();
