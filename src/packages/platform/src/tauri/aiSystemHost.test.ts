import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const broker = { dispose: vi.fn() };
  return {
    broker,
    createAISystem: vi.fn(async () => broker),
  };
});

vi.mock("./aiSystem", () => ({
  createAISystem: mocks.createAISystem,
}));

import { createAISystemHost } from "./aiSystemHost";

describe("createAISystemHost", () => {
  beforeEach(() => {
    mocks.broker.dispose.mockClear();
    mocks.createAISystem.mockClear();
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

    expect(host.ai.status).toBeTypeOf("function");
    expect(host.aiBus.subscribe).toBeTypeOf("function");
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
    host.dispose();

    expect(mocks.broker.dispose).toHaveBeenCalledOnce();
  });
});
