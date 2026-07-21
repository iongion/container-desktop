import { isExternalHttpLink } from "./linkPolicy";

type WailsInvoke = (command: string, args?: Record<string, unknown>) => Promise<any>;

export interface WailsAppWindow {
  minimize: () => Promise<unknown> | unknown;
  toggleMaximize: () => Promise<unknown> | unknown;
  unmaximize: () => Promise<unknown> | unknown;
  close: () => Promise<unknown> | unknown;
  show: () => Promise<unknown> | unknown;
  unminimize: () => Promise<unknown> | unknown;
  setFocus: () => Promise<unknown> | unknown;
}

export interface WailsWindowManagerDeps {
  appWindow: WailsAppWindow;
  invoke: WailsInvoke;
  shouldOpenExternally: (rawUrl: string) => boolean;
  appOrigin?: string;
  externalOpenDisabled?: () => boolean;
  documentRef?: Document;
}

export function createWailsWindowManager(deps: WailsWindowManagerDeps) {
  const documentRef = deps.documentRef ?? document;
  const appOrigin = deps.appOrigin ?? window.location.origin;

  function installChrome(): void {
    // Window drag is CSS-driven, exactly like Electron (NOT Tauri's JS startDragging): the shared renderer marks
    // the drag regions with `--wails-draggable: drag` alongside Electron's `-webkit-app-region: drag`
    // (AppHeader.css / appChrome.ts / NotificationCenter.css). The Wails runtime honors --wails-draggable natively
    // on WebKitGTK (and WebView2 also honors -webkit-app-region), so — like the Electron windowManager, which does
    // NOTHING for drag — there is no JS drag/resize wiring here. Frameless resize is OS-provided; the window
    // controls (min/max/close) go through appWindow via messageBus. This is a deliberate divergence from the Tauri
    // windowManager clone (whose startDragging/resize-handle layer WebKitGTK/Wails has no JS equivalent for).
  }

  function installExternalLinkHandler(target: any): void {
    const externalDisabled = deps.externalOpenDisabled ?? (() => !!target.CONTAINER_DESKTOP_MOCK);
    documentRef.addEventListener("click", (event) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = anchor?.href ?? "";
      if (!isExternalHttpLink(href, appOrigin)) {
        return;
      }
      event.preventDefault();
      if (!externalDisabled() && deps.shouldOpenExternally(href)) {
        void deps.invoke("open_external", { url: href }).catch(() => undefined);
      }
    });
  }

  function showMainWindow(): void {
    void deps.appWindow.show();
    void deps.appWindow.unminimize();
    void deps.appWindow.setFocus();
  }

  return {
    appWindow: deps.appWindow,
    installChrome,
    installExternalLinkHandler,
    showMainWindow,
  };
}
