import { describe, expect, it } from "vitest";

import { type Connection, type Connector, ContainerEngine } from "@/env/Types";

import {
  connectionEngineGroupKey,
  connectionEngineGroupName,
  findConnectionConnector,
  resolveConnectionVersion,
  visibleConnectionVersion,
} from "./connection-display";

const connection = (
  id: string,
  name: string,
  engine: ContainerEngine,
  version?: string,
  controllerVersion?: string,
): Connection =>
  ({
    id,
    name,
    label: name,
    engine,
    settings: {
      program: { name: engine, path: engine, version },
      controller: controllerVersion
        ? { name: "controller", path: "controller", version: controllerVersion }
        : undefined,
      api: { baseURL: "", connection: { uri: "", relay: "" }, autoStart: true },
      rootfull: false,
      mode: "mode.automatic",
    },
  }) as Connection;

const connector = (conn: Connection, controllerVersion: boolean): Connector =>
  ({
    ...conn,
    connectionId: conn.id,
    description: "",
    availability: { enabled: true, host: true, api: true, program: true, report: { host: "", api: "", program: "" } },
    capabilities: {
      resources: { pods: true, secrets: true },
      events: true,
      sort: {},
      extensions: {
        machines: false,
        kube: false,
        contexts: false,
        swarm: false,
        builders: false,
        compose: false,
        registries: false,
        controllerVersion,
      },
    },
  }) as Connector;

describe("connection display helpers", () => {
  it("hides empty and 'current' versions", () => {
    expect(visibleConnectionVersion("")).toBeUndefined();
    expect(visibleConnectionVersion(" current ")).toBeUndefined();
    expect(visibleConnectionVersion("5.7.0")).toBe("5.7.0");
  });

  it("resolves user-facing versions with runtime first, then program or controller fallback", () => {
    const docker = connection("system-default.docker", "System Docker", ContainerEngine.DOCKER, "29.5.3", "current");
    const podman = connection("system-default.podman", "System Podman", ContainerEngine.PODMAN, "5.7.0", "5.2.2");

    expect(resolveConnectionVersion(docker)).toBe("29.5.3");
    expect(resolveConnectionVersion(docker, { runtimeVersion: "29.6.0" })).toBe("29.6.0");
    expect(resolveConnectionVersion(podman, { connector: connector(podman, true) })).toBe("5.2.2");
  });

  it("finds a connector by either connector id or owning connection id", () => {
    const conn = connection("system-default.docker", "System Docker", ContainerEngine.DOCKER);
    const match = { ...connector(conn, false), id: "connector.default.docker", connectionId: conn.id };

    expect(findConnectionConnector(conn, [match])).toBe(match);
  });

  it("groups paired engine connections by shared target identity", () => {
    const system = connection("system-default.podman", "System Podman", ContainerEngine.PODMAN);
    const mac = connection("system-env.mac.docker", "MacOS (docker)", ContainerEngine.DOCKER);

    expect(connectionEngineGroupName(system)).toBe("System");
    expect(connectionEngineGroupKey(system)).toBe("system-default");
    expect(connectionEngineGroupName(mac)).toBe("MacOS");
    expect(connectionEngineGroupKey(mac)).toBe("system-env.mac");
  });
});
