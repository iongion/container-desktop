import { describe, expect, it, vi } from "vitest";
import { createTauriTrayBus } from "@/platform/tauri/trayBus";

describe("createTauriTrayBus", () => {
  it("accepts the tray follow channel and returns an unsubscribe", () => {
    const bus = createTauriTrayBus();
    const off = bus.subscribe("tray:switch-connection", vi.fn());
    expect(() => off()).not.toThrow();
  });

  it("keeps the TrayBus channel allowlist", () => {
    const bus = createTauriTrayBus();
    expect(() => bus.subscribe("unknown", vi.fn())).toThrow("TrayBus: subscribe not allowed");
  });
});
