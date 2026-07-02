import { describe, expect, it } from "vitest";
import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { Connector } from "@/env/Types";
import { resolveAvailabilityConnector } from "./AppSidebar.logic";

const dockerRuntime = (id: string): ConnectionRuntimeInfo =>
  ({
    id,
    engine: "docker",
    running: true,
    capabilities: {
      resources: { pods: false, secrets: false, networks: true },
      events: true,
      sort: {},
      extensions: { swarm: true, machines: false, builders: false, compose: false },
    },
  }) as unknown as ConnectionRuntimeInfo;

const podmanRuntime = (id: string): ConnectionRuntimeInfo =>
  ({
    id,
    engine: "podman",
    running: true,
    capabilities: {
      resources: { pods: true, secrets: true, networks: true },
      events: true,
      sort: {},
      extensions: { swarm: false, machines: true, builders: false, compose: false },
    },
  }) as unknown as ConnectionRuntimeInfo;

describe("resolveAvailabilityConnector", () => {
  it("uses a single running connection's capabilities even when it is NOT the current connector (Windows Docker only)", () => {
    // Only a remote docker is running; there is no current connector (or it is a disconnected/other engine).
    const result = resolveAvailabilityConnector([dockerRuntime("host.win.docker.remote")], undefined);
    expect(result?.capabilities?.extensions.swarm).toBe(true);
    expect(result?.capabilities?.resources.networks).toBe(true);
  });

  it("does not let a swarm-less current connector hide a running docker's swarm capability", () => {
    const currentConnector = {
      id: "system-default.podman",
      capabilities: { extensions: { swarm: false } },
    } as unknown as Connector;
    const result = resolveAvailabilityConnector([dockerRuntime("host.win.docker.remote")], currentConnector);
    expect(result?.capabilities?.extensions.swarm).toBe(true);
  });

  it("merges the union of capabilities across multiple running engines", () => {
    const result = resolveAvailabilityConnector(
      [dockerRuntime("system-default.docker"), podmanRuntime("system-default.podman")],
      undefined,
    );
    expect(result?.capabilities?.extensions.swarm).toBe(true); // from docker
    expect(result?.capabilities?.extensions.machines).toBe(true); // from podman
    expect(result?.capabilities?.resources.pods).toBe(true); // from podman
  });

  it("falls back to the current connector only when nothing is running", () => {
    const currentConnector = { id: "c", capabilities: { extensions: { swarm: false } } } as unknown as Connector;
    expect(resolveAvailabilityConnector([], currentConnector)).toBe(currentConnector);
  });

  it("ignores running connections that have no capabilities yet (still connecting)", () => {
    const noCaps = { id: "starting", running: true, capabilities: undefined } as unknown as ConnectionRuntimeInfo;
    const currentConnector = { id: "c" } as unknown as Connector;
    expect(resolveAvailabilityConnector([noCaps], currentConnector)).toBe(currentConnector);
  });
});
