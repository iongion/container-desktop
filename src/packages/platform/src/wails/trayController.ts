// The Wails TrayController, JS side. The native widget is Go (tray.go), but the MENU is projected here from the
// SHARED buildTrayMenuTemplate (the same projection Electron's TrayController uses) fed by the in-realm
// EngineDataService.getTrayMenuData(). Electron menu templates carry click CLOSURES, which can't cross to Go —
// so we flatten the template into (a) a serializable node tree Go builds the native menu from, and (b) a
// registry mapping generated ids → the closures, kept in THIS realm. A native menu click emits the id back over
// a Wails event, and we invoke the matching closure → EngineDataService.performAction. Rebuilt on every engine
// change (JSON-signature deduped, like Electron's TrayController).

import { buildTrayMenuTemplate, type TrayMenuData } from "@/platform/trayMenu";

// Serializable menu node (matches src-wails/tray.go MenuNode). A separator; a submenu (items); a clickable
// leaf (id); or a disabled label (no id, enabled:false — headers / "No resources").
export interface TrayMenuNode {
  id?: string;
  label?: string;
  enabled?: boolean;
  separator?: boolean;
  items?: TrayMenuNode[];
}

export interface TrayActions {
  performAction: (kind: string, id: string, connectionId: string) => void;
  showApp: () => void;
  quit: () => void;
}

// Reuse the shared projection, then split it into a serializable tree + an id→closure registry.
export function projectTrayMenu(
  data: TrayMenuData,
  actions: TrayActions,
): { items: TrayMenuNode[]; registry: Map<string, () => void> } {
  const template = buildTrayMenuTemplate(data, {
    onAction: actions.performAction,
    onShowApp: actions.showApp,
    onQuit: actions.quit,
  });
  const registry = new Map<string, () => void>();
  const walk = (items: any[]): TrayMenuNode[] =>
    items.map((item) => {
      if (item.type === "separator") {
        return { separator: true };
      }
      const node: TrayMenuNode = { label: `${item.label ?? ""}`, enabled: item.enabled !== false };
      if (item.submenu) {
        node.items = walk(item.submenu);
      } else if (typeof item.click === "function") {
        const id = `tray:${registry.size}`;
        registry.set(id, item.click);
        node.id = id;
      }
      return node;
    });
  return { items: walk(template), registry };
}

// The tray icon's engine key: a single connected engine shows its own brand mark; multiple (or none) fall back
// to unified. Only docker/podman have distinct marks — everything else (incl. Apple Container) → unified. The
// dark/light variant is chosen natively (Go reads the OS theme in tray.go).
export function trayIconEngine(data: TrayMenuData): string {
  const engines = new Set(data.connections.filter((c) => c.running).map((c) => c.engine));
  if (engines.size !== 1) {
    return "unified";
  }
  const only = [...engines][0];
  return only === "docker" || only === "podman" ? only : "unified";
}

// The engine-service surface the tray reads (a subset of EngineDataService; the hosted instance under Wails).
export interface TrayEngineService {
  getTrayMenuData: () => TrayMenuData;
  performAction: (kind: string, id: string, host: any, connectionId: string) => Promise<any>;
  getHost: (connectionId: string) => any;
  subscribe: (callback: () => void) => () => void;
}

export interface TrayControllerDeps {
  service: TrayEngineService;
  invoke: (command: string, args?: any) => Promise<any>;
  listen: (event: string, handler: (event: { payload: any }) => void) => Promise<() => void>;
  showApp: () => void;
  quit: () => void;
}

const TRAY_ACTION_EVENT = "tray://action";

// Wire the tray: rebuild the native menu on engine changes, and route native clicks back to performAction.
export function createTrayController(deps: TrayControllerDeps): { rebuild: () => void; dispose: () => void } {
  let registry = new Map<string, () => void>();
  let lastSignature = "";

  const rebuild = () => {
    const data = deps.service.getTrayMenuData();
    const projected = projectTrayMenu(data, {
      performAction: (kind, id, connectionId) => {
        void deps.service
          .performAction(kind, id, deps.service.getHost(connectionId), connectionId)
          .catch(() => undefined);
      },
      showApp: deps.showApp,
      quit: deps.quit,
    });
    const icon = trayIconEngine(data);
    const signature = JSON.stringify({ items: projected.items, icon });
    if (signature === lastSignature) {
      return; // no change — skip the native round-trip (mirrors TrayController's dedupe)
    }
    lastSignature = signature;
    registry = projected.registry;
    void deps
      .invoke("tray_update", { items: projected.items, tooltip: "Container Desktop", icon })
      .catch(() => undefined);
  };

  let unlisten: (() => void) | undefined;
  void deps
    .listen(TRAY_ACTION_EVENT, (event) => {
      registry.get(`${event.payload ?? ""}`)?.();
    })
    .then((off) => {
      unlisten = off;
    });

  const unsubscribe = deps.service.subscribe(() => rebuild());
  rebuild(); // initial build

  return {
    rebuild,
    dispose: () => {
      unsubscribe();
      unlisten?.();
    },
  };
}
