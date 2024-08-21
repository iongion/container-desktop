// vendors
import { contextBridge, ipcRenderer } from "electron";
// project
import { bridge } from "@/container-app";
import { createLogger } from "@/logger";
// locals
// Using worker to avoid users perceive the app as stuck during long operations
import { UserConfiguration } from "@/container-config";
import { CURRENT_OS_TYPE } from "../Environment";

async function main() {
  const logger = await createLogger("preload");
  logger.debug("Starting renderer process");
  contextBridge.exposeInMainWorld(
    "nativeBridge",
    await bridge.createContext({
      ipcRenderer,
      userConfiguration: await UserConfiguration.getInstance(),
      osType: CURRENT_OS_TYPE,
      version: import.meta.env.PROJECT_VERSION,
      environment: import.meta.env.ENVIRONMENT
    })
  );
  // Wait for window to bbe ready
  window.addEventListener("DOMContentLoaded", () => {
    const replaceText = (selector: any, text: any) => {
      const element = document.getElementById(selector);
      if (element) element.innerText = text;
    };
    for (const type of ["chrome", "node", "electron"]) {
      replaceText(`${type}-version`, process.versions[type]);
    }
  });
}

main();
