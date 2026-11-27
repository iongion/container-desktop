import { describe, expect, it, vi } from "vitest";

import { projectTrayMenu } from "@/platform/tauri/trayController";
import { TRAY_QUIT_ID, TRAY_SHOW_APP_ID, trayActionId } from "@/platform/trayMenu";

const oneEngine = {
  connections: [
    {
      id: "podman",
      name: "Podman",
      engine: "podman",
      running: true,
      canPause: true,
      containers: [
        { id: "c1", name: "web", state: "running" },
        { id: "c2", name: "db", state: "exited" },
      ],
      pods: [],
      machines: [],
    },
  ],
};

describe("projectTrayMenu", () => {
  it("empty → a disabled Connecting… item, no clickable ids", () => {
    const { items, registry } = projectTrayMenu(
      { connections: [] },
      { performAction: vi.fn(), showApp: vi.fn(), quit: vi.fn() },
    );
    expect(items[0]).toEqual({ label: "Connecting…", enabled: false }); // disabled, no id
    expect(registry.size).toBe(2); // only the always-present Open main window + Quit are clickable
  });

  it("names every clickable item after what it does, so no id depends on where it sits", () => {
    // The whole hazard this replaces: an id that means "the 3rd clickable item" is only meaningful to the registry
    // minted beside it. Let the native menu and this realm's registry fall out of step — one failed tray_update does
    // it — and the 3rd item natively is a DIFFERENT action here, so a click stops the wrong container. An id derived
    // from the connection, the verb and the resource cannot be remapped: at worst it is absent and does nothing.
    const empty = projectTrayMenu({ connections: [] }, { performAction: vi.fn(), showApp: vi.fn(), quit: vi.fn() });
    const full = projectTrayMenu(oneEngine as any, {
      performAction: vi.fn(),
      showApp: vi.fn(),
      quit: vi.fn(),
    });
    const idFor = (menu: { items: any[] }, label: string) => menu.items.find((item) => item.label === label)?.id;
    expect(idFor(empty, "Quit")).toBe(TRAY_QUIT_ID);
    expect(idFor(full, "Quit")).toBe(TRAY_QUIT_ID);

    // Same item, same id, in a menu of a completely different shape — the property positional ids cannot have.
    expect(idFor(empty, "Open main window")).toBe(TRAY_SHOW_APP_ID);
    expect(idFor(full, "Open main window")).toBe(TRAY_SHOW_APP_ID);

    // And an action id carries its connection, its verb and its resource, so two engines owning a container of the
    // same name cannot collide onto one another's registry entry.
    const stopDb = full.items.flatMap((i: any) => i.items ?? []).find((i: any) => i.label === 'Start "db"');
    expect(stopDb?.id).toBe(trayActionId("container.start", "c2", "podman"));
    expect([...full.registry.keys()].filter((key) => key === stopDb?.id)).toHaveLength(1);
  });

  it("never mints an id from position, at any depth", () => {
    const full = projectTrayMenu(oneEngine as any, { performAction: vi.fn(), showApp: vi.fn(), quit: vi.fn() });
    const ids: string[] = [];
    const walk = (nodes: any[]) => {
      for (const node of nodes) {
        if (typeof node.id === "string") ids.push(node.id);
        if (node.items) walk(node.items);
      }
    };
    walk(full.items);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => /^tray:\d+$/.test(id))).toEqual([]);
    // Every id the native side can send back resolves to a closure, and nothing is registered that no item shows.
    expect([...full.registry.keys()].sort()).toEqual([...new Set(ids)].sort());
  });

  it("one engine → header + Running/Stopped submenus + Open/Quit, with closures registered by id", () => {
    const performAction = vi.fn();
    const showApp = vi.fn();
    const quit = vi.fn();
    const { items, registry } = projectTrayMenu(oneEngine as any, { performAction, showApp, quit });

    expect(items[0]).toMatchObject({ label: "● Podman — podman", enabled: false }); // disabled header (no id)
    expect(items[0].id).toBeUndefined();
    expect(items[1]).toEqual({ separator: true });

    const running = items.find((i) => `${i.label}`.startsWith("Running"));
    const stopped = items.find((i) => `${i.label}`.startsWith("Stopped"));
    expect(running?.items).toHaveLength(1);
    expect(stopped?.items).toHaveLength(1);

    // the running container exposes 3 actions → a `name ▸` submenu (no id) with 3 clickable children
    const webRow = running?.items?.[0];
    expect(webRow?.label).toBe("web");
    expect(webRow?.items).toHaveLength(3);
    const pauseId = webRow?.items?.find((c) => c.label === "Pause")?.id ?? "";
    registry.get(pauseId)?.();
    expect(performAction).toHaveBeenCalledWith("container.pause", "c1", "podman");

    // the stopped container exposes 1 action → a flat clickable `Start "db"` item
    const dbRow = stopped?.items?.[0];
    expect(dbRow?.label).toBe('Start "db"');
    registry.get(dbRow?.id ?? "")?.();
    expect(performAction).toHaveBeenCalledWith("container.start", "c2", "podman");

    // Open main window + Quit route to their handlers
    registry.get(items.find((i) => i.label === "Open main window")?.id ?? "")?.();
    expect(showApp).toHaveBeenCalledTimes(1);
    registry.get(items.find((i) => i.label === "Quit")?.id ?? "")?.();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
