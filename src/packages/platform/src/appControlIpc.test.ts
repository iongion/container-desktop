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
    openTerminal: vi.fn(async () => true),
    openStorageFolder: vi.fn(),
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
