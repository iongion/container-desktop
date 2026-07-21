import { afterEach, describe, expect, it } from "vitest";

import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import { buildMockConnections, MOCK_CONTAINER_SYSTEM_ID } from "./connections";

const ORIGINAL_MOCK = process.env.CONTAINER_DESKTOP_MOCK;

afterEach(() => {
  if (ORIGINAL_MOCK === undefined) {
    delete process.env.CONTAINER_DESKTOP_MOCK;
  } else {
    process.env.CONTAINER_DESKTOP_MOCK = ORIGINAL_MOCK;
  }
});

describe("mock connections", () => {
  it("uses canonical container IDs for the Apple Container mock rows", () => {
    process.env.CONTAINER_DESKTOP_MOCK = "container";

    const connections = buildMockConnections();
    const systemContainer = connections.find(
      (connection) =>
        connection.engine === ContainerEngine.APPLE && connection.host === ContainerEngineHost.APPLE_NATIVE,
    );

    expect(systemContainer?.id).toBe(MOCK_CONTAINER_SYSTEM_ID);
    expect(systemContainer?.id).toBe("mock.container.system");
    expect(systemContainer?.settings.api.autoStart).toBe(true);
    expect(connections.some((connection) => connection.id === "mock.container.ssh")).toBe(true);
    expect(connections.some((connection) => connection.id.startsWith("mock.apple."))).toBe(false);
  });
});
