import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const broker = { disposeForSender: vi.fn() };
  return { broker, createAISystem: vi.fn(async () => broker) };
});

vi.mock("./aiSystem", () => ({
  createAISystem: mocks.createAISystem,
}));

import { createAISystemHost } from "./aiSystemHost";

describe("createAISystemHost", () => {
  beforeEach(() => {
    mocks.broker.disposeForSender.mockClear();
    mocks.createAISystem.mockClear();
  });

  it("hosts the Electron AI broker and exposes renderer cleanup", async () => {
    const deps = {
      userDataDir: "/tmp/app",
      safeStorage: {} as any,
      platform: "linux" as const,
      onInvoke: vi.fn(),
      send: vi.fn(),
      senderId: vi.fn(),
      isAllowedSender: vi.fn(),
      getAISettings: vi.fn(),
    };

    const host = await createAISystemHost(deps);
    host.disposeForSender(42);

    expect(mocks.createAISystem).toHaveBeenCalledWith(deps);
    expect(host.broker).toBe(mocks.broker);
    expect(mocks.broker.disposeForSender).toHaveBeenCalledWith(42);
  });
});
