import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import { buildTrayMenuTemplate, type TrayMenuData, type TrayMenuHandlers } from "./trayMenu";

type Item = MenuItemConstructorOptions;

const sub = (item?: Item): Item[] => (Array.isArray(item?.submenu) ? (item?.submenu as Item[]) : []);
const byLabel = (items: Item[], label: string): Item | undefined => items.find((i) => i.label === label);
const byPrefix = (items: Item[], prefix: string): Item | undefined =>
  items.find((i) => typeof i.label === "string" && (i.label as string).startsWith(prefix));

function handlers() {
  const onAction = vi.fn<(kind: string, id: string) => void>();
  const onShowApp = vi.fn<() => void>();
  const onQuit = vi.fn<() => void>();
  return { onAction, onShowApp, onQuit } satisfies TrayMenuHandlers;
}

const base: TrayMenuData = {
  running: true,
  current: { id: "c1", name: "Local", engine: "podman" },
  connections: [{ id: "c1", name: "Local", engine: "podman" }],
  containers: [],
  pods: [],
  machines: [],
};

describe("buildTrayMenuTemplate", () => {
  it("shows a placeholder + always-present actions when there is no connection", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate({ ...base, current: undefined, running: false }, h);
    expect(byLabel(items, "Connecting…")?.enabled).toBe(false);
    byLabel(items, "Open main window")?.click?.({} as any, undefined, {} as any);
    expect(h.onShowApp).toHaveBeenCalledTimes(1);
    expect(byLabel(items, "Quit")).toBeTruthy();
  });

  it("renders a radio connection switcher only when more than one connection, checked on current", () => {
    const h = handlers();
    const single = buildTrayMenuTemplate(base, h);
    expect(byLabel(single, "Connection")).toBeUndefined();

    const items = buildTrayMenuTemplate(
      {
        ...base,
        connections: [
          { id: "c1", name: "Local", engine: "podman" },
          { id: "c2", name: "Remote", engine: "docker" },
        ],
      },
      h,
    );
    const conn = sub(byLabel(items, "Connection"));
    expect(conn).toHaveLength(2);
    expect(conn[0].type).toBe("radio");
    expect(conn[0].checked).toBe(true); // current
    expect(conn[1].checked).toBe(false);
    conn[1].click?.({} as any, undefined, {} as any);
    expect(h.onAction).toHaveBeenCalledWith("connection.switch", "c2");
  });

  it("puts a running container under Running with a Pause/Stop/Restart submenu", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate({ ...base, containers: [{ id: "abc", name: "web", state: "running" }] }, h);
    const running = sub(byLabel(items, "Running (1)"));
    const actions = sub(byLabel(running, "web")).map((i) => i.label);
    expect(actions).toEqual(["Pause", "Stop", "Restart"]);
    byLabel(sub(byLabel(running, "web")), "Stop")?.click?.({} as any, undefined, {} as any);
    expect(h.onAction).toHaveBeenCalledWith("container.stop", "abc");
  });

  it("renders a stopped container as a single flat Start item (no submenu)", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate({ ...base, containers: [{ id: "xyz", name: "old", state: "exited" }] }, h);
    const stopped = sub(byLabel(items, "Stopped (1)"));
    const item = byLabel(stopped, 'Start "old"');
    expect(item).toBeTruthy();
    expect(item?.submenu).toBeUndefined();
    item?.click?.({} as any, undefined, {} as any);
    expect(h.onAction).toHaveBeenCalledWith("container.start", "xyz");
  });

  it("caps long lists and adds a Show all … item that opens the app", () => {
    const h = handlers();
    const containers = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, name: `c${i}`, state: "running" }));
    const items = buildTrayMenuTemplate({ ...base, containers }, h);
    const running = sub(byLabel(items, "Running (20)"));
    expect(running).toHaveLength(16); // 15 capped rows + overflow
    const showAll = byPrefix(running, "Show all");
    expect(showAll?.label).toBe("Show all 20 in app…");
    showAll?.click?.({} as any, undefined, {} as any);
    expect(h.onShowApp).toHaveBeenCalledTimes(1);
  });

  it("renders pods and machines sections with their state-appropriate actions", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate(
      {
        ...base,
        pods: [{ id: "p1", name: "pod-a", status: "running" }],
        machines: [{ name: "vm", running: false }],
      },
      h,
    );
    const podActs = sub(byLabel(sub(byLabel(items, "Pods")), "pod-a")).map((i) => i.label);
    expect(podActs).toEqual(["Pause", "Stop", "Restart"]);

    const machineItem = byLabel(sub(byLabel(items, "Machines")), 'Start "vm"');
    machineItem?.click?.({} as any, undefined, {} as any);
    expect(h.onAction).toHaveBeenCalledWith("machine.start", "vm");
  });

  it("fires onQuit from the Quit item", () => {
    const h = handlers();
    const items = buildTrayMenuTemplate(base, h);
    byLabel(items, "Quit")?.click?.({} as any, undefined, {} as any);
    expect(h.onQuit).toHaveBeenCalledTimes(1);
  });
});
