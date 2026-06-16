// core (electron-free): startup/runtime failure recovery. The window is frameless on Linux/Windows (its
// chrome is the React app), so a renderer that fails to load leaves no controls to quit — a native dialog is
// always interactive regardless of renderer/window state. The Electron `dialog`/`app` calls are injected as a
// port so the decision logic is unit-testable; `fallbackErrorPageURL` is a pure HTML generator.

export interface RecoveryPort {
  isReady(): boolean;
  showErrorBox(title: string, detail: string): void;
  showMessageBoxSync(options: Record<string, unknown>): number;
  relaunch(): void;
  exit(code?: number): void;
  openDevTools(): void;
  logger: { error: (...args: unknown[]) => void };
}

// Self-contained error page (no app assets / no preload needed) shown inside the window so it is never just
// blank. Actions are handled by the native recovery dialog.
export function fallbackErrorPageURL(title: string, message: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#1a051c;color:#e1d9e3;font:14px/1.5 system-ui,sans-serif;-webkit-app-region:drag}
    .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center}
    h1{font-size:18px;margin:0 0 8px}p{margin:4px 0;opacity:.8;max-width:560px}code{display:block;margin-top:12px;padding:12px;background:#00000040;border-radius:6px;white-space:pre-wrap;text-align:left;max-width:560px;overflow:auto}
  </style></head><body><div class="wrap">
    <h1>${esc(title)}</h1>
    <p>Container Desktop could not start its interface. Use the dialog to reload or quit.</p>
    <code>${esc(message)}</code>
  </div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function createRecoveryService(port: RecoveryPort) {
  let recoveryInProgress = false;

  function showRecoveryDialog(title: string, error: unknown): void {
    const detail = (error as any)?.stack || (error as any)?.message || String(error);
    port.logger.error("Recovery dialog", title, detail);
    if (recoveryInProgress) {
      return;
    }
    recoveryInProgress = true;
    // Before the app is ready, showMessageBoxSync is unavailable — use an error box then exit.
    if (!port.isReady()) {
      try {
        port.showErrorBox(`${title}`, detail);
      } catch (e: any) {
        port.logger.error("Unable to show error box", e);
      }
      port.exit(1);
      return;
    }
    let choice = 2;
    try {
      choice = port.showMessageBoxSync({
        type: "error",
        noLink: true,
        title: "Container Desktop",
        message: title,
        detail,
        buttons: ["Reload", "Open Dev Tools", "Quit"],
        defaultId: 0,
        cancelId: 2,
      });
    } catch (e: any) {
      port.logger.error("Unable to show recovery dialog", e);
      port.exit(1);
      return;
    }
    if (choice === 0) {
      port.relaunch();
      port.exit(0);
    } else if (choice === 1) {
      recoveryInProgress = false;
      try {
        port.openDevTools();
      } catch (e: any) {
        port.logger.error("Unable to open dev tools", e);
      }
    } else {
      port.exit(0);
    }
  }

  // Last-resort guards: a throw anywhere in the main process must surface a recoverable dialog rather than
  // silently leaving a blank/frozen window. After the window is up, a rejection is logged but not interrupted.
  function installProcessGuards({ hasWindow }: { hasWindow: () => boolean }): void {
    process.on("uncaughtException", (error) => {
      showRecoveryDialog("Container Desktop encountered an unexpected error", error);
    });
    process.on("unhandledRejection", (reason) => {
      port.logger.error("Unhandled promise rejection", reason);
      if (!hasWindow()) {
        showRecoveryDialog("Container Desktop failed during startup", reason);
      }
    });
  }

  return { showRecoveryDialog, installProcessGuards };
}
