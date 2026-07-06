import { describe, expect, it, vi } from "vitest";
import { createRecoveryService } from "./recovery";

function makeDeps(overrides: Partial<Parameters<typeof createRecoveryService>[0]> = {}) {
  const deps = {
    showMessage: vi.fn(async () => "Quit"),
    relaunch: vi.fn(async () => undefined),
    exit: vi.fn(async () => undefined),
    openDevTools: vi.fn(async () => undefined),
    showFallbackPage: vi.fn(),
    logger: { error: vi.fn() },
    ...overrides,
  };
  return deps;
}

describe("createRecoveryService", () => {
  it("maps the Tauri Reload dialog button to relaunch + exit", async () => {
    const deps = makeDeps({ showMessage: vi.fn(async () => "Reload") });
    await createRecoveryService(deps).showRecoveryDialog("title", new Error("boom"));
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it("maps the Tauri Open Dev Tools dialog button without exiting", async () => {
    const deps = makeDeps({ showMessage: vi.fn(async () => "Open Dev Tools") });
    await createRecoveryService(deps).showRecoveryDialog("title", new Error("boom"));
    expect(deps.openDevTools).toHaveBeenCalledTimes(1);
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it("can show the fallback page before the native recovery dialog", async () => {
    const deps = makeDeps();
    await createRecoveryService(deps).showRecoveryDialog("title", new Error("boom"), { fallbackPage: true });
    expect(deps.showFallbackPage).toHaveBeenCalledWith("title", expect.stringContaining("boom"));
    expect(deps.showMessage).toHaveBeenCalledTimes(1);
  });
});
