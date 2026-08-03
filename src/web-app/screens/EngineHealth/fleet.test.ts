import { describe, expect, it } from "vitest";

import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { Connection } from "@/container-client/types/connection";

import { buildFleet, describeTransport, summarizeFleet } from "./fleet";

const conn = (id: string, engine: string, host: string, uri = "", scope = ""): Connection =>
  ({
    id,
    name: id,
    label: id,
    engine,
    host,
    settings: {
      api: { connection: { uri, relay: "" } },
      controller: scope ? { name: "ctl", path: "/ctl", scope } : undefined,
    },
  }) as unknown as Connection;

const rt = (id: string, engine: string, phase: string, running: boolean, error?: string): ConnectionRuntimeInfo => ({
  id,
  name: id,
  engine,
  phase: phase as ConnectionRuntimeInfo["phase"],
  running,
  error,
});

describe("describeTransport", () => {
  it("native", () => {
    expect(describeTransport("podman.native").transport).toBe("native");
    expect(describeTransport("podman.native").label).toBe("native");
  });

  it("wsl carries the distro scope", () => {
    const d = describeTransport("podman.virtualized.wsl", undefined, "Ubuntu-24.04");
    expect(d.transport).toBe("wsl");
    expect(d.label).toBe("WSL");
    expect(d.detail).toBe("Ubuntu-24.04");
  });

  it("lima/vendor are a VM", () => {
    expect(describeTransport("podman.virtualized.lima").label).toBe("VM");
    expect(describeTransport("docker.virtualized.vendor").transport).toBe("vm");
  });

  it("ssh parses user@host from the uri", () => {
    const d = describeTransport("podman.remote", "ssh://demo@podman.example.test/run/x.sock");
    expect(d.transport).toBe("ssh");
    expect(d.label).toBe("SSH");
    expect(d.detail).toBe("demo@podman.example.test");
  });
});

describe("buildFleet / summarizeFleet", () => {
  it("assembles cards, folds the verdict, sorts by name, and summarizes", () => {
    const connections = [
      conn("beta", "docker", "docker.native"),
      conn("alpha", "podman", "podman.remote", "ssh://demo@host.test/run/podman.sock"),
    ];
    const runtime = [rt("beta", "docker", "ready", true), rt("alpha", "podman", "failed", false, "connection refused")];
    const fleet = buildFleet(runtime, connections, []);

    expect(fleet.map((f) => f.name)).toEqual(["alpha", "beta"]);
    expect(fleet[0].verdict.level).toBe("unreachable");
    expect(fleet[0].engineLabel).toBe("Podman");
    expect(fleet[0].subtitle).toContain("SSH");
    expect(fleet[0].subtitle).toContain("demo@host.test");
    expect(fleet[1].verdict.level).toBe("healthy");

    expect(summarizeFleet(fleet)).toEqual({ healthy: 1, degraded: 0, unreachable: 1, total: 2 });
  });

  it("falls back to runtime fields when a connection is missing", () => {
    const fleet = buildFleet([rt("ghost", "podman", "ready", true)], [], []);
    expect(fleet).toHaveLength(1);
    expect(fleet[0].name).toBe("ghost");
    expect(fleet[0].transport).toBe("native");
  });
});
