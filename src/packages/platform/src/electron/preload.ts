import { contextBridge } from "electron";
import { installElectronHostBridge } from "@/platform/electron/bridge";

function main() {
  installElectronHostBridge({ exposeInMainWorld: contextBridge.exposeInMainWorld.bind(contextBridge), target: global });
}

main();
