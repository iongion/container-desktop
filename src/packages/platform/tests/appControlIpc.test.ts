import { describe, expect, it, vi } from "vitest";

import { type AppControlIpcDeps, registerAppControlIpc } from "@/platform/appControlIpc";

function makeDeps() {
  const messageHandlers = new Map<string, (event: any, payload: any) => void>();
  const invokeHandlers = new Map<string, (event: any, payload: any) => unknown>();
  const deps = {
    onMessage: (channel: string, handler: (event: any, payload: any) => void) => messageHandlers.set(channel, handler),
    onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => invokeHandlers.set(channel, handler),
    isAllowedSender: (event: any) => event?.allowed === true,
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    restore: vi.fn(),
    close: vi.fn(),
    exit: vi.fn(),
    relaunch: vi.fn(),
    openDevTools: vi.fn(),
    showWindow: vi.fn(),
    openFileSelector: vi.fn(async () => ({ canceled: false, filePaths: ["/x"] })),
    saveFileSelector: vi.fn(async () => ({ canceled: false, filePath: "/x.json" })),
    openTerminal: vi.fn(async () => true),
    openStorageFolder: vi.fn(),
    openPath: vi.fn(),
    openInVSCode: vi.fn(async () => true),
    registerQuit: vi.fn(),
    logger: { debug: vi.fn() },
  } satisfies AppControlIpcDeps;
  return {
    deps,
    message: (channel: string, event: any, payload?: any) => messageHandlers.get(channel)?.(event, payload),
    invoke: (channel: string, event: any, payload?: any) => invokeHandlers.get(channel)?.(event, payload),
  };
}

const ALLOWED = { allowed: true };
const DENIED = { allowed: false };

describe("registerAppControlIpc", () => {
  it("runs window/app actions only for the allowed sender", () => {
    const { deps, message } = makeDeps();
    registerAppControlIpc(deps);

    message("window.minimize", ALLOWED);
    message("window.maximize", ALLOWED);
    message("application.exit", ALLOWED);
    expect(deps.minimize).toHaveBeenCalledTimes(1);
    expect(deps.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);

    message("window.minimize", DENIED);
    message("application.exit", DENIED);
    expect(deps.minimize).toHaveBeenCalledTimes(1); // unchanged
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  // The path comes from the webview, unlike openStorageFolder's, so the channel must refuse an unusable one
  // rather than forward it to the OS shell.
  it("reveals a caller-named path only for the allowed sender, and only when it names one", () => {
    const { deps, message } = makeDeps();
    registerAppControlIpc(deps);

    message("openPath", ALLOWED, "/home/user/project");
    expect(deps.openPath).toHaveBeenCalledWith("/home/user/project");

    message("openPath", DENIED, "/home/user/other");
    message("openPath", ALLOWED, "");
    message("openPath", ALLOWED, undefined);
    message("openPath", ALLOWED, { path: "/nope" });
    expect(deps.openPath).toHaveBeenCalledTimes(1);
  });

  // Same rule as openPath, on the invoke side: an unusable path is refused before it reaches the OS, and the
  // caller is told no rather than left waiting on a promise that never means anything.
  it("opens a VS Code workspace only for the allowed sender, and only when it names a path", async () => {
    const { deps, invoke } = makeDeps();
    registerAppControlIpc(deps);

    expect(await invoke("openInVSCode", ALLOWED, "/home/user/project")).toBe(true);
    expect(deps.openInVSCode).toHaveBeenCalledWith("/home/user/project");

    expect(await invoke("openInVSCode", DENIED, "/home/user/other")).toBe(false);
    expect(await invoke("openInVSCode", ALLOWED, "")).toBe(false);
    expect(await invoke("openInVSCode", ALLOWED, undefined)).toBe(false);
    expect(deps.openInVSCode).toHaveBeenCalledTimes(1);
  });

  it("shows the window on a 'ready' notify from the allowed sender", () => {
    const { deps, message } = makeDeps();
    registerAppControlIpc(deps);
    message("notify", ALLOWED, { message: "ready", payload: {} });
    expect(deps.showWindow).toHaveBeenCalledTimes(1);
    message("notify", DENIED, { message: "ready" });
    expect(deps.showWindow).toHaveBeenCalledTimes(1);
  });

  it("register.process logs without a sender gate", () => {
    const { deps, message } = makeDeps();
    registerAppControlIpc(deps);
    message("register.process", DENIED, { pid: 1 });
    expect(deps.logger.debug).toHaveBeenCalled();
  });

  it("openFileSelector returns a canceled result for a denied sender, else delegates", async () => {
    const { deps, invoke } = makeDeps();
    registerAppControlIpc(deps);
    expect(await invoke("openFileSelector", DENIED, {})).toEqual({ canceled: true, filePaths: [] });
    expect(deps.openFileSelector).not.toHaveBeenCalled();
    expect(await invoke("openFileSelector", ALLOWED, {})).toEqual({ canceled: false, filePaths: ["/x"] });
    expect(deps.openFileSelector).toHaveBeenCalledTimes(1);
  });

  it("saveFileSelector returns a canceled result for a denied sender, else delegates", async () => {
    const { deps, invoke } = makeDeps();
    registerAppControlIpc(deps);
    expect(await invoke("saveFileSelector", DENIED, {})).toEqual({ canceled: true });
    expect(deps.saveFileSelector).not.toHaveBeenCalled();
    expect(await invoke("saveFileSelector", ALLOWED, {})).toEqual({ canceled: false, filePath: "/x.json" });
    expect(deps.saveFileSelector).toHaveBeenCalledTimes(1);
  });

  it("openTerminal returns false for a denied sender, else delegates", async () => {
    const { deps, invoke } = makeDeps();
    registerAppControlIpc(deps);
    expect(await invoke("openTerminal", DENIED, {})).toBe(false);
    expect(deps.openTerminal).not.toHaveBeenCalled();
    expect(await invoke("openTerminal", ALLOWED, {})).toBe(true);
  });

  it("register.quit delegates only for the allowed sender", () => {
    const { deps, invoke } = makeDeps();
    registerAppControlIpc(deps);
    invoke("register.quit", DENIED, { command: ["x"] });
    expect(deps.registerQuit).not.toHaveBeenCalled();
    invoke("register.quit", ALLOWED, { command: ["x"] });
    expect(deps.registerQuit).toHaveBeenCalledTimes(1);
  });
});
