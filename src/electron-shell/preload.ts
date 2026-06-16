import { contextBridge } from "electron";

import { CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/node";
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
const ActivityCommand = wrapCommandForActivity(Command);
const ForwardingCommand: ICommand = { ...ActivityCommand, ProxyRequest: forwardProxyRequest };

// Patch the shared platform globals (the same set main installs); preload adds the receive buses.
installPlatformGlobals(global, {
  command: ForwardingCommand,
  messageBus: MessageBus,
  extras: { TrayBus, ResourceBus },
});

function main() {
  console.debug("Preload script loaded");
  contextBridge.exposeInMainWorld("Command", ForwardingCommand);
  contextBridge.exposeInMainWorld("Platform", Platform);
  contextBridge.exposeInMainWorld("Path", Path);
  contextBridge.exposeInMainWorld("FS", FS);
  contextBridge.exposeInMainWorld("CURRENT_OS_TYPE", CURRENT_OS_TYPE);
  contextBridge.exposeInMainWorld("MessageBus", MessageBus);
  contextBridge.exposeInMainWorld("ActivityBus", ActivityBus);
  contextBridge.exposeInMainWorld("TrayBus", TrayBus);
  contextBridge.exposeInMainWorld("ResourceBus", ResourceBus);
  contextBridge.exposeInMainWorld("Preloaded", true);
}

main();
