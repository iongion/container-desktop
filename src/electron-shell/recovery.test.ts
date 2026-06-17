import { describe, expect, it, vi } from "vitest";

import { createRecoveryService, fallbackErrorPageURL, type RecoveryPort } from "./recovery";

describe("fallbackErrorPageURL", () => {
  it("is a data URL that escapes HTML in the title and message", () => {
    const out = fallbackErrorPageURL("<b>Boom</b>", "a & b < c");
    expect(out.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    const html = decodeURIComponent(out.replace("data:text/html;charset=utf-8,", ""));
    expect(html).toContain("&lt;b&gt;Boom&lt;/b&gt;");
    expect(html).toContain("a &amp; b &lt; c");
  });
});

function makePort(overrides: Partial<RecoveryPort> = {}) {
  return {
    isReady: vi.fn(() => true),
    showErrorBox: vi.fn(),
    showMessageBoxSync: vi.fn(() => 2),
    relaunch: vi.fn(),
    exit: vi.fn(),
    openDevTools: vi.fn(),
    logger: { error: vi.fn() },
    ...overrides,
  } satisfies RecoveryPort;
}

describe("createRecoveryService.showRecoveryDialog", () => {
  it("shows an error box and exits(1) before the app is ready", () => {
    const port = makePort({ isReady: vi.fn(() => false) });
    createRecoveryService(port).showRecoveryDialog("title", new Error("x"));
    expect(port.showErrorBox).toHaveBeenCalledTimes(1);
    expect(port.exit).toHaveBeenCalledWith(1);
    expect(port.showMessageBoxSync).not.toHaveBeenCalled();
  });

  it("relaunches + exits(0) on Reload (choice 0)", () => {
    const port = makePort({ showMessageBoxSync: vi.fn(() => 0) });
    createRecoveryService(port).showRecoveryDialog("title", new Error("x"));
    expect(port.relaunch).toHaveBeenCalledTimes(1);
    expect(port.exit).toHaveBeenCalledWith(0);
  });

  it("opens dev tools without exiting on Open Dev Tools (choice 1)", () => {
    const port = makePort({ showMessageBoxSync: vi.fn(() => 1) });
    createRecoveryService(port).showRecoveryDialog("title", new Error("x"));
    expect(port.openDevTools).toHaveBeenCalledTimes(1);
    expect(port.exit).not.toHaveBeenCalled();
  });

  it("exits(0) on Quit (choice 2)", () => {
    const port = makePort({ showMessageBoxSync: vi.fn(() => 2) });
    createRecoveryService(port).showRecoveryDialog("title", new Error("x"));
    expect(port.exit).toHaveBeenCalledWith(0);
  });

  it("re-entrancy guard: a second dialog while one is in progress is ignored", () => {
    // choice 2 exits; the guard blocks a second concurrent dialog before resolution.
    const port = makePort({ showMessageBoxSync: vi.fn(() => 2) });
    const svc = createRecoveryService(port);
    svc.showRecoveryDialog("a", new Error("1"));
    svc.showRecoveryDialog("b", new Error("2"));
    expect(port.showMessageBoxSync).toHaveBeenCalledTimes(1);
  });
});
