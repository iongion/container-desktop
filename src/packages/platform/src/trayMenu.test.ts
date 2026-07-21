import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import {
  buildTrayMenuTemplate,
  type TrayConnectionData,
  type TrayMenuData,
  type TrayMenuHandlers,
} from "@/platform/trayMenu";

type Item = MenuItemConstructorOptions;

const sub = (item?: Item): Item[] => (Array.isArray(item?.submenu) ? (item?.submenu as Item[]) : []);
const byLabel = (items: Item[], label: string): Item | undefined => items.find((i) => i.label === label);
const byPrefix = (items: Item[], prefix: string): Item | undefined =>
  items.find((i) => typeof i.label === "string" && (i.label as string).startsWith(prefix));

function handlers() {
  const onAction = vi.fn<(kind: string, id: string, connectionId: string) => void>();
  const onShowApp = vi.fn<() => void>();
  const onQuit = vi.fn<() => void>();
  return { onAction, onShowApp, onQuit } satisfies TrayMenuHandlers;
}

const conn = (over: Partial<TrayConnectionData> = {}): TrayConnectionData => ({
  id: "c1",
  name: "Local",
  engine: "podman",
  running: true,
  containers: [],
  pods: [],
  machines: [],
  ...over,
});

const single = (over: Partial<TrayConnectionData> = {}): TrayMenuData => ({ connections: [conn(over)] });

describe("buildTrayMenuTemplate", () => {
  it("shows a placeholder + always-present actions when nothing is connected", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate({ connections: [conn({ running: false })] }, h);
    expect(byLabel(items, "Connecting…")?.enabled).toBe(false);
    byLabel(items, "Open main window")?.click?.({} as any, undefined, {} as any);
    expect(h.onShowApp).toHaveBeenCalledTimes(1);
    expect(byLabel(items, "Quit")).toBeTruthy();
  });

  it("renders a single connected engine's sections flat (no per-engine submenu) and routes by its id", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate(single({ containers: [{ id: "abc", name: "web", state: "running" }] }), h);
    expect(byPrefix(items, "● Local — podman")?.enabled).toBe(false);
    const running = sub(byLabel(items, "Running (1)"));
    const actions = sub(byLabel(running, "web")).map((i) => i.label);
    expect(actions).toEqual(["Pause", "Stop", "Restart"]);
    byLabel(sub(byLabel(running, "web")), "Stop")?.click?.({} as any, undefined, {} as any);
    expect(h.onAction).toHaveBeenCalledWith("container.stop", "abc", "c1");
  });

  it("groups each engine under a 'name — engine' section when several are connected, routing per engine", () => {
    const h = handlers();
    const data: TrayMenuData = {
      connections: [
        conn({
          id: "pod",
          name: "Podman",
          engine: "podman",
          containers: [{ id: "p1", name: "web", state: "running" }],
        }),
        conn({ id: "dok", name: "Docker", engine: "docker", containers: [{ id: "d1", name: "api", state: "exited" }] }),
      ],
    };
    const items = buildTrayMenuTemplate(data, h);
    expect(byPrefix(items, "● 2 engines connected")).toBeTruthy();

    const podSection = sub(byLabel(items, "Podman — podman"));
    const webActions = sub(byLabel(sub(byLabel(podSection, "Running (1)")), "web"));
    byLabel(webActions, "Stop")?.click?.({} as any, undefined, {} as any);
    expect(h.onAction).toHaveBeenCalledWith("container.stop", "p1", "pod");

    const dokSection = sub(byLabel(items, "Docker — docker"));
    byLabel(sub(byLabel(dokSection, "Stopped (1)")), 'Start "api"')?.click?.({} as any, undefined, {} as any);
    expect(h.onAction).toHaveBeenCalledWith("container.start", "d1", "dok");
  });

  it("renders a stopped container as a single flat Start item (no submenu)", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate(single({ containers: [{ id: "xyz", name: "old", state: "exited" }] }), h);
    const stopped = sub(byLabel(items, "Stopped (1)"));
    const item = byLabel(stopped, 'Start "old"');
    expect(item).toBeTruthy();
    expect(item?.submenu).toBeUndefined();
    item?.click?.({} as any, undefined, {} as any);
    expect(h.onAction).toHaveBeenCalledWith("container.start", "xyz", "c1");
  });

  it("caps long lists and adds a Show all … item that opens the app", () => {
    const h = handlers();
    const containers = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, name: `c${i}`, state: "running" }));
    const items = buildTrayMenuTemplate(single({ containers }), h);
    const running = sub(byLabel(items, "Running (20)"));
    expect(running).toHaveLength(16); // 15 capped rows + overflow
    const showAll = byPrefix(running, "Show all");
    expect(showAll?.label).toBe("Show all 20 in app…");
    showAll?.click?.({} as any, undefined, {} as any);
    expect(h.onShowApp).toHaveBeenCalledTimes(1);
  });

  it("renders pods and machines sections with their state-appropriate actions, routed to the connection", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate(
      single({ pods: [{ id: "p1", name: "pod-a", status: "running" }], machines: [{ name: "vm", running: false }] }),
      h,
    );
    const podActs = sub(byLabel(sub(byLabel(items, "Pods")), "pod-a")).map((i) => i.label);
    expect(podActs).toEqual(["Pause", "Stop", "Restart"]);

    const machineItem = byLabel(sub(byLabel(items, "Machines")), 'Start "vm"');
    machineItem?.click?.({} as any, undefined, {} as any);
    expect(h.onAction).toHaveBeenCalledWith("machine.start", "vm", "c1");
  });

  it("fires onQuit from the Quit item", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate(single(), h);
    byLabel(items, "Quit")?.click?.({} as any, undefined, {} as any);
    expect(h.onQuit).toHaveBeenCalledTimes(1);
  });
});
