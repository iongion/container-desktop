import * as Electron from "electron";

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
  Electron.contextBridge.exposeInMainWorld("Command", Command);
  Electron.contextBridge.exposeInMainWorld("Platform", Platform);
  Electron.contextBridge.exposeInMainWorld("Path", Path);
  Electron.contextBridge.exposeInMainWorld("FS", FS);
  Electron.contextBridge.exposeInMainWorld("CURRENT_OS_TYPE", CURRENT_OS_TYPE);
  Electron.contextBridge.exposeInMainWorld("MessageBus", MessageBus);
  Electron.contextBridge.exposeInMainWorld("Preloaded", true);
}

main();
