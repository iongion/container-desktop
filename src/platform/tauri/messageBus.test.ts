import { describe, expect, it, vi } from "vitest";
import { createMessageBus } from "./messageBus";

function makeDeps() {
  const resourceSyncHost = {
    handles: vi.fn((channel: string) => channel === "RESOURCE_SYNC:get-snapshot"),
    invoke: vi.fn(() => ({ from: "resource" })),
    send: vi.fn(),
  } as any;
  const invoke = vi.fn(async (command: string) => {
    if (command === "get_home_dir") return "/home/istoica";
    if (command === "logging_apply") return { logFile: "/tmp/app.log" };
    if (command === "launch_terminal") return { success: true };
    return undefined;
  });
  return {
    deps: {
      resourceSyncHost,
      invoke,
      appWindow: {
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        unmaximize: vi.fn(),
        close: vi.fn(),
        show: vi.fn(),
        setFocus: vi.fn(),
      },
      openFileDialog: vi.fn(async () => "/tmp/Dockerfile"),
      exit: vi.fn(),
      relaunch: vi.fn(),
      applyProxy: vi.fn(async () => ({ ok: true, proxy: { mode: "disabled" } })),
      testProxy: vi.fn(async () => ({ ok: true, url: "http://example.com/" })),
      logger: { debug: vi.fn() },
    },
    resourceSyncHost,
    invoke,
  };
}

describe("createMessageBus", () => {
  it("routes window/app control through the shared app-control registrar", () => {
    const { deps } = makeDeps();
    const bus = createMessageBus(deps);

    bus.send("window.minimize");
    bus.send("window.maximize");
    bus.send("application.exit");

    expect(deps.appWindow.minimize).toHaveBeenCalledTimes(1);
    expect(deps.appWindow.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it("normalizes Tauri file-dialog output to the Electron OpenDialogReturnValue shape", async () => {
    const { deps } = makeDeps();
    const bus = createMessageBus(deps);

    await expect(bus.invoke("openFileSelector", { directory: false })).resolves.toEqual({
      canceled: false,
      filePaths: ["/tmp/Dockerfile"],
    });
    expect(deps.openFileDialog).toHaveBeenCalledWith({
      directory: false,
      multiple: false,
      filters: undefined,
      defaultPath: "/home/istoica",
    });
  });

  it("routes logging through the shared logging registrar", async () => {
    const { deps, invoke } = makeDeps();
    const bus = createMessageBus(deps);

    await expect(bus.invoke("logging:apply")).resolves.toEqual({ logFile: "/tmp/app.log" });

    expect(invoke).toHaveBeenCalledWith("logging_apply");
  });

  it("routes RESOURCE_SYNC channels to the hosted resource-sync bus first", async () => {
    const { deps, resourceSyncHost } = makeDeps();
    const bus = createMessageBus(deps);

    bus.send("RESOURCE_SYNC:get-snapshot", { ignored: true });
    await expect(bus.invoke("RESOURCE_SYNC:get-snapshot")).resolves.toEqual({ from: "resource" });

    expect(resourceSyncHost.send).toHaveBeenCalledWith("RESOURCE_SYNC:get-snapshot", { ignored: true });
    expect(resourceSyncHost.invoke).toHaveBeenCalledWith("RESOURCE_SYNC:get-snapshot", undefined);
  });

  it("routes proxy apply/test through the shared app-control registrar", async () => {
    const { deps } = makeDeps();
    const bus = createMessageBus(deps);

    await expect(bus.invoke("proxy.apply", { mode: "disabled" })).resolves.toEqual({
      ok: true,
      proxy: { mode: "disabled" },
    });
    await expect(bus.invoke("proxy.test", { mode: "disabled" })).resolves.toEqual({
      ok: true,
      url: "http://example.com/",
    });

    expect(deps.applyProxy).toHaveBeenCalledWith({ mode: "disabled" });
    expect(deps.testProxy).toHaveBeenCalledWith({ mode: "disabled" });
  });
});
