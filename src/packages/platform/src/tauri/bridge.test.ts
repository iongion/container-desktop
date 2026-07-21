import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configReads: [] as Array<{ key: string; hasPlatform: boolean; hasPath: boolean; hasFS: boolean }>,
  invoke: vi.fn(async (command: string) => {
    switch (command) {
      case "get_os_type":
        return "Linux";
      case "get_env_var":
        return "";
      case "get_user_data_path":
        return "/tmp/container-desktop-test";
      default:
        return undefined;
    }
  }),
  appWindow: {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    show: vi.fn(),
    unminimize: vi.fn(),
    setFocus: vi.fn(),
    startDragging: vi.fn(),
    startResizeDragging: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class Channel {},
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mocks.appWindow,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(async () => "Quit"),
  open: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(async () => undefined),
  relaunch: vi.fn(async () => undefined),
}));

vi.mock("@/container-client/config", () => ({
  userConfiguration: {
    getKey: vi.fn(async (key: string) => {
      const target = window as any;
      mocks.configReads.push({
        key,
        hasPlatform: !!target.Platform,
        hasPath: !!target.Path,
        hasFS: !!target.FS,
      });
      return undefined;
    }),
    setProxyConfig: vi.fn(async () => undefined),
  },
}));

vi.mock("./aiSystemHost", () => ({
  createAISystemHost: vi.fn(async () => ({ ai: {}, aiBus: {} })),
}));

vi.mock("./command", () => ({
  ActivityBus: {},
  createCommand: vi.fn(() => ({})),
}));

vi.mock("./messageBus", () => ({
  createMessageBus: vi.fn(() => ({
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

vi.mock("./resourceBus", () => ({
  createTauriResourceBus: vi.fn(() => ({
    subscribe: vi.fn(() => () => undefined),
  })),
}));

vi.mock("./resourceSyncHost", () => ({
  createResourceSyncHost: vi.fn(() => ({ service: {} })),
}));

vi.mock("./trayBus", () => ({
  createTauriTrayBus: vi.fn(() => ({})),
}));

vi.mock("./trayController", () => ({
  createTrayController: vi.fn(() => ({})),
}));

describe("installTauriHostBridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.configReads.length = 0;
    document.body.replaceChildren();
    for (const key of [
      "Platform",
      "Path",
      "FS",
      "CURRENT_OS_TYPE",
      "CURRENT_DARWIN_MAJOR",
      "Command",
      "MessageBus",
      "Preloaded",
    ]) {
      delete (window as any)[key];
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("installs storage globals before reading persisted config", async () => {
    const { installTauriHostBridge } = await import("./bridge");

    await installTauriHostBridge();

    expect(mocks.configReads[0]).toEqual({
      key: "proxy",
      hasPlatform: true,
      hasPath: true,
      hasFS: true,
    });
    expect((window as any).Preloaded).toBe(true);
  });

  it("keeps the native window hidden when the bridge installs but the renderer has not signaled ready", async () => {
    vi.useFakeTimers();
    const { installTauriHostBridge } = await import("./bridge");

    await installTauriHostBridge();

    expect(mocks.appWindow.show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8000);
    expect(mocks.appWindow.show).not.toHaveBeenCalled();
  });
});
