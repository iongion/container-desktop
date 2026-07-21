import { isExternalHttpLink } from "./linkPolicy";

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<any>;

export interface TauriAppWindow {
  minimize: () => Promise<unknown> | unknown;
  toggleMaximize: () => Promise<unknown> | unknown;
  unmaximize: () => Promise<unknown> | unknown;
  close: () => Promise<unknown> | unknown;
  show: () => Promise<unknown> | unknown;
  unminimize: () => Promise<unknown> | unknown;
  setFocus: () => Promise<unknown> | unknown;
  startDragging: () => Promise<unknown> | unknown;
  startResizeDragging: (direction: never) => Promise<unknown> | unknown;
}

export interface TauriWindowManagerDeps {
  appWindow: TauriAppWindow;
  invoke: TauriInvoke;
  shouldOpenExternally: (rawUrl: string) => boolean;
  appOrigin?: string;
  externalOpenDisabled?: () => boolean;
  documentRef?: Document;
}

const DRAG_REGION_SELECTOR = "#AppHeader, #app-boot-header, #app-splash";
const NO_DRAG_SELECTOR =
  "button, a, input, select, textarea, [role='button'], .bp6-button, .AppHeaderActions, #app-boot-controls, .NotificationCenter, [data-no-drag]";

const RESIZE_HANDLES: Array<{ dir: string; css: string }> = [
  { dir: "North", css: "top:0;left:10px;right:10px;height:5px;cursor:ns-resize" },
  { dir: "South", css: "bottom:0;left:10px;right:10px;height:5px;cursor:ns-resize" },
  { dir: "West", css: "top:10px;bottom:10px;left:0;width:5px;cursor:ew-resize" },
  { dir: "East", css: "top:10px;bottom:10px;right:0;width:5px;cursor:ew-resize" },
  { dir: "NorthWest", css: "top:0;left:0;width:10px;height:10px;cursor:nwse-resize" },
  { dir: "NorthEast", css: "top:0;right:0;width:10px;height:10px;cursor:nesw-resize" },
  { dir: "SouthWest", css: "bottom:0;left:0;width:10px;height:10px;cursor:nesw-resize" },
  { dir: "SouthEast", css: "bottom:0;right:0;width:10px;height:10px;cursor:nwse-resize" },
];

export function createTauriWindowManager(deps: TauriWindowManagerDeps) {
  const documentRef = deps.documentRef ?? document;
  const appOrigin = deps.appOrigin ?? window.location.origin;

  function installChrome(): void {
    const inDragRegion = (node: EventTarget | null): boolean => {
      const el = node as HTMLElement | null;
      return !!el?.closest?.(DRAG_REGION_SELECTOR) && !el.closest(NO_DRAG_SELECTOR);
    };
    documentRef.addEventListener("mousedown", (event) => {
      if (event.button === 0 && inDragRegion(event.target)) {
        void deps.appWindow.startDragging();
      }
    });
    documentRef.addEventListener("dblclick", (event) => {
      if (inDragRegion(event.target)) {
        void deps.appWindow.toggleMaximize();
      }
    });
    const layer = documentRef.createElement("div");
    layer.setAttribute("data-tauri-resize-layer", "");
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    for (const { dir, css } of RESIZE_HANDLES) {
      const handle = documentRef.createElement("div");
      handle.style.cssText = `position:fixed;pointer-events:auto;${css}`;
      handle.addEventListener("mousedown", (event) => {
        if (event.button === 0) {
          event.preventDefault();
          void deps.appWindow.startResizeDragging(dir as never);
        }
      });
      layer.appendChild(handle);
    }
    documentRef.body.appendChild(layer);
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
