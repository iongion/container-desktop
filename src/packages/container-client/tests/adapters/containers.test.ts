import { describe, expect, it } from "vitest";

import { ContainersAdapter } from "@/container-client/adapters/containers";
import type { HostClientFacade } from "@/container-client/runtimes/facade";

// The engine reports a container's name with Docker's historical leading slash (`Names: ["/web"]`), and that payload is
// what a caller hands back as the id — the UI from a row, a client from a listing. Percent-encoded it
// reaches the API as `%2Fweb`, which answers 404 "no such container" while the bare name answers 204. Measured against
// a real podman socket, so every request path is asserted here rather than at one helper: a site that skips the rule
// is the defect, and only the path it built shows it.
function recordingHost() {
  const paths: string[] = [];
  const record = (path: string) => {
    paths.push(path);
  };
  const driver = {
    get: async (path: string) => {
      record(path);
      // Logs decode a binary frame; everything else reads an object. Shaped enough for the real normalizer to run.
      if (path.includes("/logs")) return { status: 200, data: new Uint8Array() };
      return { status: 200, data: { Id: "abc", State: "running" } };
    },
    post: async (path: string) => {
      record(path);
      return { status: 200, data: true };
    },
    delete: async (path: string) => {
      record(path);
      return { status: 204, data: true };
    },
  };
  const host = { apiSurface: "podman", getApiDriver: async () => driver } as unknown as HostClientFacade;
  return { adapter: new ContainersAdapter(host), paths };
}

describe("ContainersAdapter — the id the engine itself published", () => {
  it("removes a container named the way the engine reports it", async () => {
    const { adapter, paths } = recordingHost();
    await adapter.remove("/web");
    expect(paths).toEqual(["/containers/web"]);
  });

  // Every mutation the UI's row actions can reach. One test per op, because the
  // failure mode is a single site that kept the raw id.
  it("strips it on every lifecycle operation", async () => {
    const { adapter, paths } = recordingHost();
    await adapter.start("/web");
    await adapter.stop("/web");
    await adapter.pause("/web");
    await adapter.unpause("/web");
    await adapter.restart("/web");
    expect(paths).toEqual([
      "/containers/web/start",
      "/containers/web/stop",
      "/containers/web/pause",
      "/containers/web/unpause",
      // restart stops first, then restarts.
      "/containers/web/stop",
      "/containers/web/restart",
    ]);
  });

  it("strips it on every read as well", async () => {
    const { adapter, paths } = recordingHost();
    await adapter.get("/web");
    await adapter.stats("/web");
    await adapter.processes("/web");
    await adapter.logs("/web");
    expect(paths).toEqual([
      "/containers/web/json",
      "/containers/web/stats",
      "/containers/web/top",
      "/containers/web/logs",
    ]);
  });

  it("leaves an id that carries no slash exactly as it was", async () => {
    const { adapter, paths } = recordingHost();
    const id = "9f2c1b7ae4d05f3a8c6e1d4b2a7f0e9c3d5b8a1f6e2c4d7b0a9f3e5c1d8b2a4f";
    await adapter.remove(id);
    expect(paths).toEqual([`/containers/${id}`]);
  });

  // Normalize THEN encode: the slash is the engine's own spelling and comes off, but nothing else about escaping a
  // path segment changes — an id that needs encoding still gets it.
  it("still percent-encodes the rest of the segment", async () => {
    const { adapter, paths } = recordingHost();
    await adapter.remove("//odd name");
    expect(paths).toEqual(["/containers/odd%20name"]);
  });
});
