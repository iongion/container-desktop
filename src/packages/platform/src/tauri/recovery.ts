import type { MessageDialogOptions } from "@tauri-apps/plugin-dialog";
import {
  createRecoveryService as createCommonRecoveryService,
  errorDetail,
  fallbackErrorPageHTML,
  type RecoveryChoice,
} from "@/platform/recovery";

type ShowMessage = (message: string, options?: string | MessageDialogOptions) => Promise<string>;

export interface TauriRecoveryDeps {
  showMessage: ShowMessage;
  relaunch: () => Promise<unknown> | unknown;
  exit: (code?: number) => Promise<unknown> | unknown;
  openDevTools: () => Promise<unknown> | unknown;
  showFallbackPage?: (title: string, detail: string) => void;
  logger: { error: (...args: unknown[]) => void };
}

export interface TauriRecoveryService {
  showRecoveryDialog(title: string, error: unknown, options?: { fallbackPage?: boolean }): Promise<void>;
  installWebviewGuards(target: Window): void;
}

function choiceFromDialogResult(result: string): RecoveryChoice {
  switch (result) {
    case "Reload":
    case "Yes":
      return "reload";
    case "Open Dev Tools":
    case "No":
      return "devtools";
    default:
      return "quit";
  }
}

export function writeFallbackErrorPage(documentRef: Document, title: string, detail: string): void {
  documentRef.open();
  documentRef.write(fallbackErrorPageHTML(title, detail));
  documentRef.close();
}

export function createRecoveryService(deps: TauriRecoveryDeps): TauriRecoveryService {
  const service = createCommonRecoveryService({
    isReady: () => true,
    showFatalError: (title, detail) =>
      deps.showMessage(`${title}\n\n${detail}`, { title: "Container Desktop", kind: "error" }),
    chooseRecoveryAction: async (title, detail) => {
      const result = await deps.showMessage(`${title}\n\n${detail}`, {
        title: "Container Desktop",
        kind: "error",
        buttons: { yes: "Reload", no: "Open Dev Tools", cancel: "Quit" },
      });
      return choiceFromDialogResult(result);
    },
    relaunch: deps.relaunch,
    exit: deps.exit,
    openDevTools: deps.openDevTools,
    logger: deps.logger,
  });

  const showRecoveryDialog: TauriRecoveryService["showRecoveryDialog"] = async (title, error, options) => {
    const detail = errorDetail(error);
    if (options?.fallbackPage) {
      deps.showFallbackPage?.(title, detail);
    }
    await service.showRecoveryDialog(title, error);
  };

  function installWebviewGuards(target: Window): void {
    target.addEventListener("error", (event) => {
      const error = (event as ErrorEvent).error;
      if (!error) {
        return;
      }
      void showRecoveryDialog("Container Desktop encountered an unexpected error", error, {
        fallbackPage: !(target as any).Preloaded,
      });
    });
    target.addEventListener("unhandledrejection", (event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      deps.logger.error("Unhandled promise rejection", reason);
      if (!(target as any).Preloaded) {
        void showRecoveryDialog("Container Desktop failed during startup", reason, { fallbackPage: true });
      }
    });
  }

  return { showRecoveryDialog, installWebviewGuards };
}
