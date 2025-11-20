import { contextBridge } from "electron";

import { CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/node";
import { Command } from "@/platform/node-executor";
import { MessageBus } from "./shared";

// patch global like in preload
(global as any).Command = Command;
(global as any).Platform = Platform;
(global as any).Path = Path;
(global as any).FS = FS;
(global as any).CURRENT_OS_TYPE = CURRENT_OS_TYPE;
(global as any).MessageBus = MessageBus;

function main() {
  console.debug("Preload script loaded");
  contextBridge.exposeInMainWorld("Command", Command);
  contextBridge.exposeInMainWorld("Platform", Platform);
  contextBridge.exposeInMainWorld("Path", Path);
  contextBridge.exposeInMainWorld("FS", FS);
  contextBridge.exposeInMainWorld("CURRENT_OS_TYPE", CURRENT_OS_TYPE);
  contextBridge.exposeInMainWorld("MessageBus", MessageBus);
  contextBridge.exposeInMainWorld("Preloaded", true);
}

main();
