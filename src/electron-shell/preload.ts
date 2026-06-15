import { contextBridge } from "electron";

import { CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/node";
import { Command } from "@/platform/node-executor";
import { ActivityBus, wrapCommandForActivity } from "./activityBus";
import { MessageBus } from "./shared";

// Wrap Command BEFORE exposing it so every renderer-initiated CLI call is captured for the
// Activity Log. The wrapped instance is what both the global patch and the renderer see.
const ActivityCommand = wrapCommandForActivity(Command);

// patch global like in preload
(global as any).Command = ActivityCommand;
(global as any).Platform = Platform;
(global as any).Path = Path;
(global as any).FS = FS;
(global as any).CURRENT_OS_TYPE = CURRENT_OS_TYPE;
(global as any).MessageBus = MessageBus;

function main() {
  console.debug("Preload script loaded");
  contextBridge.exposeInMainWorld("Command", ActivityCommand);
  contextBridge.exposeInMainWorld("Platform", Platform);
  contextBridge.exposeInMainWorld("Path", Path);
  contextBridge.exposeInMainWorld("FS", FS);
  contextBridge.exposeInMainWorld("CURRENT_OS_TYPE", CURRENT_OS_TYPE);
  contextBridge.exposeInMainWorld("MessageBus", MessageBus);
  contextBridge.exposeInMainWorld("ActivityBus", ActivityBus);
  contextBridge.exposeInMainWorld("Preloaded", true);
}

main();
