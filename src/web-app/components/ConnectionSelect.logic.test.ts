import { describe, expect, it } from "vitest";

import { type Connection, ContainerEngine } from "@/env/Types";

import {
  connectedConnections,
  isComposeConnection,
  isPodmanConnection,
  pickActiveConnection,
} from "./ConnectionSelect.logic";

const conn = (id: string, engine: ContainerEngine): Connection => ({ id, name: id, engine }) as Connection;

const podman = conn("podman.system", ContainerEngine.PODMAN);
const docker = conn("docker.system", ContainerEngine.DOCKER);
const podmanSsh = conn("podman.ssh", ContainerEngine.PODMAN);
const connections = [podman, docker, podmanSsh];

describe("connectedConnections", () => {
  it("returns only running connections, preserving configured order", () => {
    const runtime = [
      { id: "docker.system", running: true },
      { id: "podman.system", running: true },
      { id: "podman.ssh", running: false },
    ];
    expect(connectedConnections(connections, runtime)).toEqual([podman, docker]);
  });

  it("drops connections with no runtime entry", () => {
    expect(connectedConnections(connections, [])).toEqual([]);
  });

  it("applies the eligibility filter (Podman-only)", () => {
    const runtime = [
      { id: "podman.system", running: true },
      { id: "docker.system", running: true },
    ];
    expect(connectedConnections(connections, runtime, isPodmanConnection)).toEqual([podman]);
  });
});

describe("isComposeConnection", () => {
  it("accepts Podman and Docker but not Apple container", () => {
    expect(isComposeConnection(podman)).toBe(true);
    expect(isComposeConnection(docker)).toBe(true);
    expect(isComposeConnection(conn("apple", ContainerEngine.APPLE))).toBe(false);
  });
});

describe("pickActiveConnection", () => {
  const items = [podman, docker];

  it("prefers the explicit value", () => {
    expect(pickActiveConnection(items, "docker.system", "podman.system")).toBe(docker);
  });

  it("falls back to the primary default when the value is empty or unknown", () => {
    expect(pickActiveConnection(items, "", "docker.system")).toBe(docker);
    expect(pickActiveConnection(items, "missing", "docker.system")).toBe(docker);
  });

  it("falls back to the first item when neither value nor default match", () => {
    expect(pickActiveConnection(items, "", "nope")).toBe(podman);
  });

  it("returns undefined when nothing is eligible", () => {
    expect(pickActiveConnection([], "x", "y")).toBeUndefined();
  });
});
