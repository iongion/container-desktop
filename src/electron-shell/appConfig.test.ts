import { describe, expect, it } from "vitest";

import { createAppConfig, type SettingsStore } from "./appConfig";

function makeStore(values: Record<string, unknown> = {}): SettingsStore {
  const data: Record<string, unknown> = { ...values };
  return {
    getKey: async <T>(key: string, def: T): Promise<T> => (key in data ? (data[key] as T) : def),
    setKey: async (key: string, value: unknown) => {
      data[key] = value;
      return value;
    },
  };
}

describe("createAppConfig", () => {
  it("defaults trayWidgetEnabled to true and window config to {}", async () => {
    const cfg = createAppConfig(makeStore());
    expect(await cfg.isTrayWidgetEnabled()).toBe(true);
    expect(await cfg.getWindowConfig()).toEqual({});
  });

  it("isHideToTrayOnClose: true when minimizeToSystemTray is set", async () => {
    const cfg = createAppConfig(makeStore({ minimizeToSystemTray: true, trayWidgetEnabled: false }));
    expect(await cfg.isHideToTrayOnClose()).toBe(true);
  });

  it("isHideToTrayOnClose: falls back to the tray-widget flag when minimize-to-tray is off", async () => {
    expect(await createAppConfig(makeStore({ trayWidgetEnabled: true })).isHideToTrayOnClose()).toBe(true);
    expect(await createAppConfig(makeStore({ trayWidgetEnabled: false })).isHideToTrayOnClose()).toBe(false);
  });

  it("reads back a persisted window config", async () => {
    const cfg = createAppConfig(makeStore({ window: { width: 1000, height: 700 } }));
    expect(await cfg.getWindowConfig()).toEqual({ width: 1000, height: 700 });
  });
});
