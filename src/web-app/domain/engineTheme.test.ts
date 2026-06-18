import { describe, expect, it } from "vitest";

import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import { type Connector, ContainerEngine } from "@/env/Types";
import { resolveEngineTheme } from "./engineTheme";

function runtime(engine: ContainerEngine, id: string = engine, running = true): ConnectionRuntimeInfo {
  return {
    id,
    name: id,
    engine,
    phase: running ? "ready" : "failed",
    running,
  };
}

function connector(engine: ContainerEngine, available: boolean): Connector {
  return {
    id: `connector.${engine}`,
    connectionId: `connection.${engine}`,
    name: engine,
    label: engine,
    description: engine,
    engine,
    host: `${engine}.native`,
    availability: {
      enabled: true,
      api: available,
      host: available,
      program: available,
      report: { host: "", api: "", program: "" },
    },
    settings: {} as Connector["settings"],
  } as Connector;
}

describe("resolveEngineTheme", () => {
  it("defaults to unified before discovery or connection data exists", () => {
    expect(resolveEngineTheme({ activeRuntime: [], connectors: [] })).toBe("unified");
  });

  it("honors explicit user overrides", () => {
    expect(
      resolveEngineTheme({ preference: "unified", activeRuntime: [runtime(ContainerEngine.PODMAN)], connectors: [] }),
    ).toBe("unified");
    expect(
      resolveEngineTheme({ preference: "docker", activeRuntime: [runtime(ContainerEngine.PODMAN)], connectors: [] }),
    ).toBe(ContainerEngine.DOCKER);
    expect(
      resolveEngineTheme({ preference: "podman", activeRuntime: [runtime(ContainerEngine.DOCKER)], connectors: [] }),
    ).toBe(ContainerEngine.PODMAN);
  });

  it("uses a single running engine in automatic mode", () => {
    expect(
      resolveEngineTheme({ preference: "auto", activeRuntime: [runtime(ContainerEngine.PODMAN)], connectors: [] }),
    ).toBe(ContainerEngine.PODMAN);
    expect(
      resolveEngineTheme({ preference: "auto", activeRuntime: [runtime(ContainerEngine.DOCKER)], connectors: [] }),
    ).toBe(ContainerEngine.DOCKER);
  });

  it("keeps one engine theme for several running connections of the same engine", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [runtime(ContainerEngine.PODMAN, "podman-1"), runtime(ContainerEngine.PODMAN, "podman-2")],
        connectors: [],
      }),
    ).toBe(ContainerEngine.PODMAN);
  });

  it("uses unified when multiple engine families are running", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [runtime(ContainerEngine.PODMAN), runtime(ContainerEngine.DOCKER)],
        connectors: [],
      }),
    ).toBe("unified");
  });

  it("falls back to a single discovered available engine before runtime is connected", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [],
        connectors: [connector(ContainerEngine.DOCKER, true), connector(ContainerEngine.PODMAN, false)],
      }),
    ).toBe(ContainerEngine.DOCKER);
  });

  it("keeps unified when discovery finds several available engine families", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [],
        connectors: [connector(ContainerEngine.DOCKER, true), connector(ContainerEngine.PODMAN, true)],
      }),
    ).toBe("unified");
  });
});
