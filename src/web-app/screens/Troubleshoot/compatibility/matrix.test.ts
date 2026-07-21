import { describe, expect, it } from "vitest";

import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { ConnectorCapabilities } from "@/container-client/types/connection";

import { buildCompatibilityMatrix, sortVersionsDesc } from "./matrix";

// Capability fixtures mirror the real dialect bases (podman.ts / docker.ts / container.ts) + host tuning.
const podmanCaps = (extOver: Partial<ConnectorCapabilities["extensions"]> = {}): ConnectorCapabilities => ({
  resources: { pods: true, secrets: true, networks: true },
  events: true,
  sort: {},
  extensions: {
    machines: true,
    kube: true,
    contexts: false,
    swarm: false,
    builders: false,
    compose: true,
    registries: true,
    registryTrust: true,
    controllerVersion: false,
    ...extOver,
  },
});

const dockerCaps = (): ConnectorCapabilities => ({
  resources: { pods: false, secrets: false, networks: true },
  events: true,
  sort: {},
  extensions: {
    machines: false,
    kube: false,
    contexts: false,
    swarm: true,
    builders: false,
    compose: true,
    registries: false,
    registryTrust: true,
    controllerVersion: false,
  },
});

const containerCaps = (): ConnectorCapabilities => ({
  resources: { pods: false, secrets: false, networks: true },
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
    registryTrust: false,
    controllerVersion: false,
  },
});

const rt = (over: Partial<ConnectionRuntimeInfo>): ConnectionRuntimeInfo => ({
  id: "id",
  name: "name",
  engine: "podman",
  phase: "ready",
  running: true,
  ...over,
});

function cellsOf(m: ReturnType<typeof buildCompatibilityMatrix>, key: string) {
  for (const g of m.groups) {
    const row = g.rows.find((r) => r.key === key);
    if (row) return row.cells;
  }
  throw new Error(`no row: ${key}`);
}

describe("sortVersionsDesc", () => {
  it("dedupes and sorts newest-first", () => {
    expect(sortVersionsDesc(["5.1.0", "5.2.0", "5.1.0"])).toEqual(["5.2.0", "5.1.0"]);
  });
  it("coerces loose tags and drops blanks", () => {
    expect(sortVersionsDesc(["", "27.3", "27.3.1", "  "])).toEqual(["27.3.1", "27.3"]);
  });
});

describe("buildCompatibilityMatrix", () => {
  it("always shows every supported engine as a column (podman, docker, container), in a fixed order", () => {
    const m = buildCompatibilityMatrix([
      rt({ id: "p1", engine: "podman", version: "5.2.0", capabilities: podmanCaps() }),
      rt({ id: "p2", engine: "podman", version: "5.1.0", capabilities: podmanCaps() }),
      rt({ id: "d1", engine: "docker", version: "27.3.1", capabilities: dockerCaps() }),
    ]);
    expect(m.columns).toEqual([
      { engine: "podman", versions: ["5.2.0", "5.1.0"], connectionCount: 2, connected: true },
      { engine: "docker", versions: ["27.3.1"], connectionCount: 1, connected: true },
      { engine: "container", versions: [], connectionCount: 0, connected: false },
    ]);
  });

  it("a disconnected engine reads no versions (n/a) but still shows its base capabilities", () => {
    const m = buildCompatibilityMatrix([
      rt({ id: "p", engine: "podman", version: "5.2.0", capabilities: podmanCaps() }),
    ]);
    // docker is column index 1 (fixed order), not connected
    expect(m.columns[1]).toEqual({ engine: "docker", versions: [], connectionCount: 0, connected: false });
    // base Docker capabilities still populate the cells (swarm yes, pods no)
    expect(cellsOf(m, "swarm")[1].kind).toBe("yes");
    expect(cellsOf(m, "pods")[1].kind).toBe("no");
  });

  it("a non-running or capability-less connection does not count as connected", () => {
    const m = buildCompatibilityMatrix([
      rt({ id: "ok", engine: "podman", capabilities: podmanCaps() }),
      rt({ id: "down", engine: "docker", running: false, capabilities: dockerCaps() }),
      rt({ id: "nocaps", engine: "docker", capabilities: undefined }),
    ]);
    expect(m.columns.map((c) => [c.engine, c.connected])).toEqual([
      ["podman", true],
      ["docker", false],
      ["container", false],
    ]);
  });

  it("computes engine-driven cells (dialect, pods, swarm, events)", () => {
    const m = buildCompatibilityMatrix([
      rt({ id: "p", engine: "podman", capabilities: podmanCaps() }),
      rt({ id: "d", engine: "docker", capabilities: dockerCaps() }),
      rt({ id: "c", engine: "container", capabilities: containerCaps() }),
    ]);
    expect(cellsOf(m, "dialect")).toEqual([
      { kind: "value", value: "libpod" },
      { kind: "value", value: "docker" },
      { kind: "value", value: "docker" },
    ]);
    expect(cellsOf(m, "pods").map((c) => c.kind)).toEqual(["yes", "no", "no"]);
    expect(cellsOf(m, "swarm").map((c) => c.kind)).toEqual(["no", "yes", "no"]);
    expect(cellsOf(m, "events").map((c) => c.kind)).toEqual(["yes", "yes", "yes"]);
  });

  it("unions capabilities across an engine's connections (a native Podman provides machines even if a remote can't)", () => {
    const m = buildCompatibilityMatrix([
      rt({ id: "native", engine: "podman", capabilities: podmanCaps() }),
      rt({ id: "remote", engine: "podman", capabilities: podmanCaps({ machines: false }) }),
    ]);
    expect(m.columns[0]).toEqual({ engine: "podman", versions: [], connectionCount: 2, connected: true });
    expect(cellsOf(m, "machines")[0]).toEqual({ kind: "yes" });
  });

  it("marks machine lifecycle unavailable (footnote 2) when NO Podman connection is native", () => {
    const m = buildCompatibilityMatrix([
      rt({ id: "remote", engine: "podman", capabilities: podmanCaps({ machines: false }) }),
      rt({ id: "d", engine: "docker", capabilities: dockerCaps() }),
    ]);
    // podman col 0, docker col 1
    expect(cellsOf(m, "machines")[0]).toEqual({ kind: "no", footnote: 2 });
    expect(cellsOf(m, "machines")[1]).toEqual({ kind: "no" });
  });

  it("shows real gaps as planned/partial keyed to footnotes; Apple container has no Compose", () => {
    const m = buildCompatibilityMatrix([
      rt({ id: "p", engine: "podman", capabilities: podmanCaps() }),
      rt({ id: "d", engine: "docker", capabilities: dockerCaps() }),
      rt({ id: "c", engine: "container", capabilities: containerCaps() }),
    ]);
    expect(cellsOf(m, "compose")).toEqual([{ kind: "yes" }, { kind: "yes" }, { kind: "no" }]);
    expect(cellsOf(m, "registries")).toEqual([{ kind: "yes" }, { kind: "partial", footnote: 1 }, { kind: "no" }]);
    expect(cellsOf(m, "contexts")).toEqual([{ kind: "no" }, { kind: "partial", footnote: 3 }, { kind: "no" }]);
    expect(cellsOf(m, "imagebuild").map((c) => c.kind)).toEqual(["yes", "yes", "yes"]);
    expect(cellsOf(m, "testcontainers")).toEqual([
      { kind: "planned", footnote: 4 },
      { kind: "planned", footnote: 4 },
      { kind: "planned", footnote: 4 },
    ]);
  });
});
