// core (electron-free): the logging-control IPC registrar. Mirrors registerAppControlIpc — the transport
// (`onInvoke`) and the actions (apply file config / open the log file / reveal it) are injected, so it is
// shell-agnostic and unit-testable. The composition root wires the real ipcMain + the electron-log main
// adapter; a Tauri shell would supply its own transport + actions behind the SAME channel contract.

// Channel names are shell-neutral so any shell + the renderer client can reuse them.
export const LOGGING_CHANNELS = {
  apply: "logging:apply",
  open: "logging:open",
  reveal: "logging:reveal",
} as const;

export interface LoggingIpcDeps {
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  // Gate every handler to the main app window only.
  isAllowedSender: (event: any) => boolean;
  // Re-read the persisted logging policy and apply it; returns the resolved log file path.
  applyConfig: () => Promise<{ logFile: string }>;
  // Open the active log file; the result lets the renderer toast when it's missing/inaccessible.
  openLogFile: () => Promise<{ ok: boolean; reason?: string; detail?: string }>;
  // Reveal the active log file in the OS file manager; same result contract.
  revealLogFile: () => Promise<{ ok: boolean; reason?: string; detail?: string }>;
}

export function registerLoggingIpc(deps: LoggingIpcDeps): void {
  deps.onInvoke(LOGGING_CHANNELS.apply, async (event) => {
    if (!deps.isAllowedSender(event)) {
      return { logFile: "" };
    }
    return deps.applyConfig();
  });
  deps.onInvoke(LOGGING_CHANNELS.open, async (event) => {
    if (!deps.isAllowedSender(event)) {
      return { ok: false, reason: "denied" };
    }
    return deps.openLogFile();
  });
  deps.onInvoke(LOGGING_CHANNELS.reveal, async (event) => {
    if (!deps.isAllowedSender(event)) {
      return { ok: false, reason: "denied" };
    }
    return deps.revealLogFile();
  });
}
