import { describe, expect, it } from "vitest";

import { buildResourceContext, type ConnectionResourceSummary } from "./resourceContext";

const conn = (over: Partial<ConnectionResourceSummary> = {}): ConnectionResourceSummary => ({
  name: "c",
  engine: "podman",
  connected: true,
  containers: 0,
  running: 0,
  images: 0,
  pods: 0,
  volumes: 0,
  networks: 0,
  secrets: 0,
  ...over,
});

describe("buildResourceContext — the assistant's view of the live environment", () => {
  it("states clearly when nothing is connected", () => {
    expect(buildResourceContext([])).toBe("No container connections are currently open.");
  });

  it("lists each open connection with its per-domain counts", () => {
    const out = buildResourceContext([
      conn({
        name: "podman-local",
        engine: "podman",
        connected: true,
        containers: 5,
        running: 2,
        images: 12,
        volumes: 3,
        networks: 4,
        secrets: 1,
      }),
    ]);
    expect(out).toContain("Open container connections (1):");
    expect(out).toContain('"podman-local"');
    expect(out).toContain("[podman, connected]");
    expect(out).toContain("containers=5 running=2 images=12");
    expect(out).toContain("volumes=3 networks=4 secrets=1");
  });

  it("sums per-domain totals across all connections and flags disconnected ones", () => {
    const out = buildResourceContext([
      conn({ name: "a", containers: 5, running: 2, images: 12 }),
      conn({ name: "b", engine: "docker", connected: false, containers: 3, running: 1, images: 8 }),
    ]);
    expect(out).toContain('"b" [docker, disconnected]');
    expect(out).toContain("Totals: containers=8 running=3 images=20");
  });
});
