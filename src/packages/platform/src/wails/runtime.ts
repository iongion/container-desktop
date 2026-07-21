import type { WailsAppWindow } from "./windowManager";

export interface RuntimeOptions {
  appWindow: WailsAppWindow;
  documentRef?: Document;
  appOrigin?: string;
}

// Wails runtime setup for the webview shell. Electron's runtime resolves renderer/preload/icon paths because
// Electron main owns those; Wails's Go config owns loading/icons, so this runtime owns the webview-level setup
// that bridge.ts otherwise had inline.
export function createRuntime(options: RuntimeOptions) {
  const documentRef = options.documentRef ?? document;
  const appOrigin = options.appOrigin ?? window.location.origin;

  function tuneWebviewRendering(): void {
    if (documentRef.querySelector("[data-wails-font-tuning]")) {
      return;
    }
    const style = documentRef.createElement("style");
    style.setAttribute("data-wails-font-tuning", "");
    style.textContent =
      "html{font-synthesis:none;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;}";
    documentRef.head.appendChild(style);
  }

  return {
    appWindow: options.appWindow,
    appOrigin,
    tuneWebviewRendering,
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
