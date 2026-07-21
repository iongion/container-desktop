// Recovery state machine shared by shell adapters. The shell owns the native UI (Electron dialog, Tauri
// dialog plugin) and lifecycle actions; this module owns the choices, re-entrancy guard, and fallback page.

export type RecoveryChoice = "reload" | "devtools" | "quit";

export interface RecoveryPort {
  isReady(): boolean;
  showFatalError(title: string, detail: string): unknown;
  chooseRecoveryAction(title: string, detail: string): RecoveryChoice | Promise<RecoveryChoice>;
  relaunch(): unknown;
  exit(code?: number): unknown;
  openDevTools(): unknown;
  logger: { error: (...args: unknown[]) => void };
}

export function errorDetail(error: unknown): string {
  return (error as any)?.stack || (error as any)?.message || String(error);
}

export function fallbackErrorPageHTML(title: string, message: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#1a051c;color:#e1d9e3;font:14px/1.5 system-ui,sans-serif;-webkit-app-region:drag}
    .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center}
    h1{font-size:18px;margin:0 0 8px}p{margin:4px 0;opacity:.8;max-width:560px}code{display:block;margin-top:12px;padding:12px;background:#00000040;border-radius:6px;white-space:pre-wrap;text-align:left;max-width:560px;overflow:auto}
  </style></head><body><div class="wrap">
    <h1>${esc(title)}</h1>
    <p>Container Desktop could not start its interface. Use the dialog to reload or quit.</p>
    <code>${esc(message)}</code>
  </div></body></html>`;
}

// Self-contained error page (no app assets / no preload needed) shown inside the window so it is never just
// blank. Actions are handled by the native recovery dialog.
export function fallbackErrorPageURL(title: string, message: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(fallbackErrorPageHTML(title, message))}`;
}

async function safely(label: string, port: RecoveryPort, action: () => unknown): Promise<void> {
  try {
    await action();
  } catch (error: any) {
    port.logger.error(label, error);
  }
}

export function createRecoveryService(port: RecoveryPort) {
  let recoveryInProgress = false;

  async function showRecoveryDialog(title: string, error: unknown): Promise<void> {
    const detail = errorDetail(error);
    port.logger.error("Recovery dialog", title, detail);
    if (recoveryInProgress) {
      return;
    }
    recoveryInProgress = true;
    if (!port.isReady()) {
      await safely("Unable to show error box", port, () => port.showFatalError(`${title}`, detail));
      await safely("Unable to exit after recovery failure", port, () => port.exit(1));
      return;
    }

    let choice: RecoveryChoice = "quit";
    try {
      choice = await port.chooseRecoveryAction(title, detail);
    } catch (error: any) {
      port.logger.error("Unable to show recovery dialog", error);
      await safely("Unable to exit after recovery dialog failure", port, () => port.exit(1));
      return;
    }

    if (choice === "reload") {
      await safely("Unable to relaunch after recovery choice", port, () => port.relaunch());
      await safely("Unable to exit after recovery relaunch", port, () => port.exit(0));
    } else if (choice === "devtools") {
      recoveryInProgress = false;
      await safely("Unable to open dev tools", port, () => port.openDevTools());
    } else {
      await safely("Unable to exit after recovery quit", port, () => port.exit(0));
    }
  }

  return { showRecoveryDialog };
}
