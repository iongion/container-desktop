// core (electron-free): user-settings + window-geometry accessors over the platform-neutral
// `userConfiguration`. Kept off Electron so it is unit-testable with a mock store and reusable by any shell.

import { userConfiguration } from "@/container-client/config";
import { debounce } from "@/utils";

export interface SettingsStore {
  getKey<T>(key: string, defaultValue: T): Promise<T>;
  setKey(key: string, value: unknown): Promise<unknown>;
}

export function createAppConfig(store: SettingsStore = userConfiguration as unknown as SettingsStore) {
  // Persisting geometry on every resize/move would thrash the config file — debounce the writes.
  const setWindowConfig = debounce(async (opts: Record<string, unknown>) => {
    return await store.setKey("window", opts);
  }, 500);

  return {
    isTrayWidgetEnabled: (): Promise<boolean> => store.getKey<boolean>("trayWidgetEnabled", true),
    // Closing the window hides to the tray when either the explicit "minimize to tray" setting is on, or the
    // tray widget is enabled (so the app + its menu stay alive). Explicit Quit still terminates.
    async isHideToTrayOnClose(): Promise<boolean> {
      if (await store.getKey<boolean>("minimizeToSystemTray", false)) {
        return true;
      }
      return await store.getKey<boolean>("trayWidgetEnabled", true);
    },
    getWindowConfig: (): Promise<Record<string, unknown>> => store.getKey<Record<string, unknown>>("window", {}),
    setWindowConfig,
  };
}

export type AppConfig = ReturnType<typeof createAppConfig>;
