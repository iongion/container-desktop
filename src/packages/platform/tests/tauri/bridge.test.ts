import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configReads: [] as Array<{ key: string; hasPlatform: boolean; hasPath: boolean; hasFS: boolean }>,
  settings: {} as Record<string, unknown>,
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "get_os_type":
        return "Linux";
      case "get_env_var":
        // Echo the name back so a test can prove which variables the bridge forwards into the webview.
        return `env:${args?.name ?? ""}`;
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
  save: vi.fn(async () => null),
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
      return mocks.settings[key];
    }),
    setProxyConfig: vi.fn(async () => undefined),
  },
}));

vi.mock("@/platform/tauri/command", () => ({
  ActivityBus: {},
  createCommand: vi.fn(() => ({})),
}));

vi.mock("@/platform/tauri/messageBus", () => ({
  createMessageBus: vi.fn(() => ({
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

vi.mock("@/platform/tauri/resourceBus", () => ({
  createTauriResourceBus: vi.fn(() => ({
    subscribe: vi.fn(() => () => undefined),
  })),
}));

vi.mock("@/platform/tauri/resourceSyncHost", () => ({
  createResourceSyncHost: vi.fn(() => ({ service: {} })),
}));

vi.mock("@/platform/tauri/trayBus", () => ({
  createTauriTrayBus: vi.fn(() => ({})),
}));

vi.mock("@/platform/tauri/trayController", () => ({
  createTrayController: vi.fn(() => ({})),
}));

describe("installTauriHostBridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.configReads.length = 0;
    mocks.settings = {};
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
      "CONTAINER_DESKTOP_MOCK",
      "CONTAINER_DESKTOP_MOCK_SWARM",
      "CONTAINER_DESKTOP_LOG_LEVEL",
    ]) {
      delete (window as any)[key];
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("installs storage globals before reading persisted config", async () => {
    const { installTauriHostBridge } = await import("@/platform/tauri/bridge");

    await installTauriHostBridge();

    expect(mocks.configReads[0]).toEqual({
      key: "proxy",
      hasPlatform: true,
      hasPath: true,
      hasFS: true,
    });
    expect((window as any).Preloaded).toBe(true);
  });

  it("forwards the mock-configuration env vars into the webview realm", async () => {
    const { installTauriHostBridge } = await import("@/platform/tauri/bridge");

    await installTauriHostBridge();

    // The webview has no `process`, so mode.ts reads these as globals. The swarm scenario is what
    // webdriver/specs/swarm-ui.e2e.js selects its fixture state with, so it has to cross the boundary too.
    expect((window as any).CONTAINER_DESKTOP_MOCK).toBe("env:CONTAINER_DESKTOP_MOCK");
    expect((window as any).CONTAINER_DESKTOP_MOCK_SWARM).toBe("env:CONTAINER_DESKTOP_MOCK_SWARM");
  });

  // `CONTAINER_DESKTOP_LOG_LEVEL=debug <app>` must reach the logger in a packaged build, where the build-time value is
  // empty: the webview reads the level as a global (getEnvironmentLogLevel).
  it("forwards the launch-time log level into the webview realm", async () => {
    const { installTauriHostBridge } = await import("@/platform/tauri/bridge");

    await installTauriHostBridge();

    expect((window as any).CONTAINER_DESKTOP_LOG_LEVEL).toBe("env:CONTAINER_DESKTOP_LOG_LEVEL");
  });

  it("keeps the native window hidden when the bridge installs but the renderer has not signaled ready", async () => {
    vi.useFakeTimers();
    const { installTauriHostBridge } = await import("@/platform/tauri/bridge");

    await installTauriHostBridge();

    expect(mocks.appWindow.show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8000);
    expect(mocks.appWindow.show).not.toHaveBeenCalled();
  });

  it("starts the MCP listener at boot when the settings enable it", async () => {
    mocks.settings.mcp = { enabled: true, port: 18080, mode: "allow" };
    const { installTauriHostBridge } = await import("@/platform/tauri/bridge");

    await installTauriHostBridge();

    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("mcp_start", { port: 18080, mode: "allow", allowDegraded: false }),
    );
  });

  it("leaves the MCP listener off at boot by default", async () => {
    const { installTauriHostBridge } = await import("@/platform/tauri/bridge");

    await installTauriHostBridge();

    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("mcp_stop"));
    expect(mocks.invoke).not.toHaveBeenCalledWith("mcp_start", expect.anything());
  });
});
