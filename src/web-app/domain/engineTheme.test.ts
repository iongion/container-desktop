import { describe, expect, it } from "vitest";

import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { Connection, Connector } from "@/container-client/types/connection";
import { ContainerEngine } from "@/container-client/types/engine";
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

function starting(engine: ContainerEngine, id: string = engine): ConnectionRuntimeInfo {
  return { id, name: id, engine, phase: "starting", running: false };
}

function conn(engine: ContainerEngine, opts: { autoStart?: boolean; disabled?: boolean } = {}): Connection {
  const { autoStart = true, disabled = false } = opts;
  return {
    id: `connection.${engine}`,
    name: engine,
    label: engine,
    engine,
    host: `${engine}.native` as Connection["host"],
    disabled,
    settings: { api: { autoStart } } as Connection["settings"],
  } as Connection;
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

  // Bootstrap settling: connectAll brings engines up one at a time, so the running set is briefly partial.
  // The theme must reflect the predicted steady state (from the connections being brought up), not flicker.
  it("stays unified while a second engine is still starting (no docker flash during connectAll)", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [runtime(ContainerEngine.DOCKER), starting(ContainerEngine.PODMAN)],
        connectors: [],
        connections: [conn(ContainerEngine.DOCKER), conn(ContainerEngine.PODMAN)],
      }),
    ).toBe("unified");
  });

  it("predicts unified before the second engine even appears in runtime (connect-order race)", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [starting(ContainerEngine.DOCKER)],
        connectors: [],
        connections: [conn(ContainerEngine.DOCKER), conn(ContainerEngine.PODMAN)],
      }),
    ).toBe("unified");
  });

  it("keeps a single configured engine stable while it is still starting (no unified flash)", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [starting(ContainerEngine.DOCKER)],
        connectors: [],
        connections: [conn(ContainerEngine.DOCKER)],
      }),
    ).toBe(ContainerEngine.DOCKER);
  });

  it("ignores disabled / non-autostart connections when predicting during settling", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [starting(ContainerEngine.DOCKER)],
        connectors: [],
        connections: [conn(ContainerEngine.DOCKER), conn(ContainerEngine.PODMAN, { disabled: true })],
      }),
    ).toBe(ContainerEngine.DOCKER);
  });

  it("falls back to the surviving engine once a second engine has settled as failed", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [runtime(ContainerEngine.DOCKER), runtime(ContainerEngine.PODMAN, "podman", false)],
        connectors: [],
        connections: [conn(ContainerEngine.DOCKER), conn(ContainerEngine.PODMAN)],
      }),
    ).toBe(ContainerEngine.DOCKER);
  });

  // Apple theme tests
  it("container-only → own theme", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [runtime(ContainerEngine.APPLE)],
        connectors: [],
      }),
    ).toBe(ContainerEngine.APPLE);
  });

  it("container + docker → unified (mixed)", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [runtime(ContainerEngine.APPLE), runtime(ContainerEngine.DOCKER)],
        connectors: [],
      }),
    ).toBe("unified");
  });

  it("container + podman → unified (mixed)", () => {
    expect(
      resolveEngineTheme({
        preference: "auto",
        activeRuntime: [runtime(ContainerEngine.APPLE), runtime(ContainerEngine.PODMAN)],
        connectors: [],
      }),
    ).toBe("unified");
  });

  // Apple Container is an engine, not a selectable theme: a stale stored "container" preference is
  // ignored and the theme resolves from the active engine (here Podman), not forced to container.
  it("ignores a stale container preference (not a selectable theme)", () => {
    expect(
      resolveEngineTheme({
        preference: "container",
        activeRuntime: [runtime(ContainerEngine.PODMAN)],
        connectors: [],
      }),
    ).toBe(ContainerEngine.PODMAN);
  });
});
