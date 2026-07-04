import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const broker = { disposeForSender: vi.fn() };
  const ai = { request: vi.fn() };
  const aiBus = { subscribe: vi.fn() };
  return {
    ai,
    aiBus,
    broker,
    createAISystem: vi.fn(async () => broker),
    createTauriAIBus: vi.fn(() => aiBus),
    createTauriAIClient: vi.fn(() => ai),
  };
});

vi.mock("./aiSystem", () => ({
  createAISystem: mocks.createAISystem,
}));

vi.mock("./aiBus", () => ({
  createTauriAIBus: mocks.createTauriAIBus,
}));

vi.mock("./aiClient", () => ({
  createTauriAIClient: mocks.createTauriAIClient,
}));

import { createAISystemHost } from "./aiSystemHost";

describe("createAISystemHost", () => {
  beforeEach(() => {
    mocks.broker.disposeForSender.mockClear();
    mocks.createAISystem.mockClear();
    mocks.createTauriAIBus.mockClear();
    mocks.createTauriAIClient.mockClear();
  });

  it("hosts the Tauri AI broker behind the in-realm AI client and bus", async () => {
    const deps = {
      invoke: vi.fn(),
      fs: {} as any,
      path: {} as any,
      userDataDir: "/tmp/app",
      getAISettings: vi.fn(),
      engineOps: {} as any,
      mock: true,
      logger: { error: vi.fn() },
    };

    const host = await createAISystemHost(deps);

    expect(host.ai).toBe(mocks.ai);
    expect(host.aiBus).toBe(mocks.aiBus);
    expect(mocks.createAISystem).toHaveBeenCalledWith(
      expect.objectContaining({
        invoke: deps.invoke,
        fs: deps.fs,
        path: deps.path,
        userDataDir: deps.userDataDir,
        getAISettings: deps.getAISettings,
        engineOps: deps.engineOps,
        mock: true,
        logger: deps.logger,
      }),
    );
    expect(mocks.createTauriAIClient).toHaveBeenCalledOnce();
    expect(mocks.createTauriAIBus).toHaveBeenCalledOnce();

    host.dispose();

    expect(mocks.broker.disposeForSender).toHaveBeenCalledWith(1);
  });
});
