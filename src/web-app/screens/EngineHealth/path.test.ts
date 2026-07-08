import { describe, expect, it } from "vitest";

import type { ReachabilityHop } from "@/container-client/reachability/model";
import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";

import type { FleetConnection } from "./fleet";
import { derivePath } from "./path";

const card = (partial: Partial<FleetConnection>): FleetConnection => ({
  id: "c",
  name: "c",
  engine: "docker",
  engineLabel: "Docker",
  transport: "native",
  transportLabel: "native",
  subtitle: "Docker · native",
  verdict: { level: "healthy", reasons: [] },
  runtime: { id: "c", name: "c", engine: "docker", phase: "ready", running: true } as ConnectionRuntimeInfo,
  ...partial,
});

const ids = (hops: ReachabilityHop[]) => hops.map((h) => h.id);
const byId = (hops: ReachabilityHop[], id: string) => hops.find((h) => h.id === id);

describe("derivePath", () => {
  it("native docker healthy → host → docker.sock → Docker API → Engine, all ok", () => {
    const hops = derivePath(card({ engine: "docker", transport: "native" }));
    expect(ids(hops)).toEqual(["host", "socket", "api", "engine"]);
    expect(byId(hops, "socket")?.name).toBe("docker.sock");
    expect(byId(hops, "api")?.name).toBe("Docker API");
    expect(hops.every((h) => h.state === "ok")).toBe(true);
  });

  it("native podman uses podman.sock + libpod API", () => {
    const hops = derivePath(card({ engine: "podman", transport: "native" }));
    expect(byId(hops, "socket")?.name).toBe("podman.sock");
    expect(byId(hops, "api")?.name).toBe("libpod API");
  });

  it("vm transport inserts a Machine VM hop", () => {
    const hops = derivePath(card({ engine: "podman", transport: "vm", transportDetail: "podman-lima" }));
    expect(ids(hops)).toEqual(["host", "vm", "socket", "api", "engine"]);
    expect(byId(hops, "vm")?.meta).toBe("podman-lima");
  });

  it("ssh unreachable with a tunnel timeout breaks at the tunnel; downstream is dead", () => {
    const hops = derivePath(
      card({
        engine: "docker",
        transport: "ssh",
        verdict: { level: "unreachable", reasons: ["ssh timeout"] },
        runtime: {
          id: "c",
          name: "c",
          engine: "docker",
          phase: "failed",
          running: false,
          error: "ssh: connect to host 192.168.0.31 port 22: Connection timed out",
        } as ConnectionRuntimeInfo,
      }),
    );
    expect(ids(hops)).toEqual(["host", "tunnel", "socket", "api", "engine"]);
    expect(byId(hops, "host")?.state).toBe("ok");
    expect(byId(hops, "tunnel")?.state).toBe("err");
    expect(byId(hops, "socket")?.state).toBe("dead");
    expect(byId(hops, "engine")?.state).toBe("dead");
  });

  it("ssh unreachable with the tunnel up breaks at the remote socket", () => {
    const hops = derivePath(
      card({
        engine: "podman",
        transport: "ssh",
        verdict: { level: "unreachable", reasons: ["socket down"] },
        runtime: {
          id: "c",
          name: "c",
          engine: "podman",
          phase: "failed",
          running: false,
          error: "remote podman.sock is not responding",
        } as ConnectionRuntimeInfo,
      }),
    );
    expect(byId(hops, "tunnel")?.state).toBe("ok");
    expect(byId(hops, "socket")?.state).toBe("err");
    expect(byId(hops, "api")?.state).toBe("dead");
  });

  it("degraded leaves the path nominally up (all ok)", () => {
    const hops = derivePath(card({ verdict: { level: "degraded", reasons: ["Reconnecting…"] } }));
    expect(hops.every((h) => h.state === "ok")).toBe(true);
  });
});
