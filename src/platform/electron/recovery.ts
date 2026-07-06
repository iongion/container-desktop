// Electron adapter for the shared recovery state machine. The window is frameless on Linux/Windows (its chrome is
// the React app), so a renderer that fails to load leaves no controls to quit; Electron supplies the native dialog
// + process guards, while platform/recovery owns the reusable choice handling.

import {
  createRecoveryService as createCommonRecoveryService,
  fallbackErrorPageURL,
  type RecoveryChoice,
} from "@/platform/recovery";

export { fallbackErrorPageURL };

export interface RecoveryPort {
  isReady(): boolean;
  showErrorBox(title: string, detail: string): void;
  showMessageBoxSync(options: Record<string, unknown>): number;
  relaunch(): void;
  exit(code?: number): void;
  openDevTools(): void;
  logger: { error: (...args: unknown[]) => void };
}

export function createRecoveryService(port: RecoveryPort) {
  const service = createCommonRecoveryService({
    isReady: port.isReady,
    showFatalError: (title, detail) => port.showErrorBox(title, detail),
    chooseRecoveryAction: (_title, detail): RecoveryChoice => {
      const choice = port.showMessageBoxSync({
        type: "error",
        noLink: true,
        title: "Container Desktop",
        message: _title,
        detail,
        buttons: ["Reload", "Open Dev Tools", "Quit"],
        defaultId: 0,
        cancelId: 2,
      });
      return choice === 0 ? "reload" : choice === 1 ? "devtools" : "quit";
    },
    relaunch: port.relaunch,
    exit: port.exit,
    openDevTools: port.openDevTools,
    logger: port.logger,
  });

  // Last-resort guards: a throw anywhere in the main process must surface a recoverable dialog rather than
  // silently leaving a blank/frozen window. After the window is up, a rejection is logged but not interrupted.
  function installProcessGuards({ hasWindow }: { hasWindow: () => boolean }): void {
    process.on("uncaughtException", (error) => {
      void service.showRecoveryDialog("Container Desktop encountered an unexpected error", error);
    });
    process.on("unhandledRejection", (reason) => {
      port.logger.error("Unhandled promise rejection", reason);
      if (!hasWindow()) {
        void service.showRecoveryDialog("Container Desktop failed during startup", reason);
      }
    });
  }

  return { ...service, installProcessGuards };
}
