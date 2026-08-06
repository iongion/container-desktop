import { describe, expect, it, vi } from "vitest";

import { projectTrayMenu } from "@/platform/tauri/trayController";
import { TRAY_QUIT_ID } from "@/platform/trayMenu";

const oneEngine = {
  connections: [
    {
      id: "podman",
      name: "Podman",
      engine: "podman",
      running: true,
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

  it("gives Quit the same id whatever else is in the menu, so the native side can answer it alone", () => {
    // Positional ids are only meaningful to the registry minted beside them. Quit has to keep working when the
    // native menu and this realm's registry disagree — which is exactly when it is needed — so it is not positional.
    const empty = projectTrayMenu({ connections: [] }, { performAction: vi.fn(), showApp: vi.fn(), quit: vi.fn() });
    const full = projectTrayMenu(oneEngine as any, {
      performAction: vi.fn(),
      showApp: vi.fn(),
      quit: vi.fn(),
    });
    const quitId = (menu: { items: any[] }) => menu.items.find((item) => item.label === "Quit")?.id;
    expect(quitId(empty)).toBe(TRAY_QUIT_ID);
    expect(quitId(full)).toBe(TRAY_QUIT_ID);
    // …and it does not consume a positional slot, so the menus either side of it keep counting from where they were.
    expect(empty.items.find((item) => item.label === "Open main window")?.id).toBe("tray:0");
    expect(full.items.find((item) => item.label === "Open main window")?.id).toMatch(/^tray:\d+$/);
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
