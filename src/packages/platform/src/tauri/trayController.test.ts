import { describe, expect, it, vi } from "vitest";

import { projectTrayMenu } from "./trayController";

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
