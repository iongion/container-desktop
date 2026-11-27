import { describe, expect, it } from "vitest";

import { LIST_TIMEOUT_MS } from "@/container-client/adapters/baseUrls";
import { ContainersAdapter } from "@/container-client/adapters/containers";
import { ImagesAdapter } from "@/container-client/adapters/images";
import { NetworksAdapter } from "@/container-client/adapters/networks";
import { PodsAdapter } from "@/container-client/adapters/pods";
import { SecretsAdapter } from "@/container-client/adapters/secrets";
import { VolumesAdapter } from "@/container-client/adapters/volumes";
import type { HostClientFacade } from "@/container-client/runtimes/facade";

// The lists every screen shows. A busy engine (Docker starting dozens of containers at login) takes seconds to
// answer one; under the 3 s request default the list failed and the screen stayed empty. And a list that answers
// an error must say so, never pass for "this engine has nothing".
const LISTS = [
  { what: "containers", Adapter: ContainersAdapter, surface: "docker" },
  { what: "images", Adapter: ImagesAdapter, surface: "docker" },
  { what: "volumes", Adapter: VolumesAdapter, surface: "docker" },
  { what: "networks", Adapter: NetworksAdapter, surface: "docker" },
  { what: "pods", Adapter: PodsAdapter, surface: "podman" },
  { what: "secrets", Adapter: SecretsAdapter, surface: "docker" },
] as const;

function fakeHost(surface: string, answer: (path: string) => { status: number; data: unknown }) {
  const calls: { path: string; timeout?: number }[] = [];
  const driver = {
    get: async (path: string, config?: { timeout?: number }) => {
      calls.push({ path, timeout: config?.timeout });
      return answer(path);
    },
  };
  const host = { apiSurface: surface, getApiDriver: async () => driver } as unknown as HostClientFacade;
  return { host, calls };
}

const emptyList = (path: string) => ({ status: 200, data: path === "/volumes" ? { Volumes: [] } : [] });

describe.each(LISTS)("$what list", ({ what, Adapter, surface }) => {
  it("waits as long as a busy engine needs, not the 3 s ping limit", async () => {
    const { host, calls } = fakeHost(surface, emptyList);
    await new Adapter(host).list();
    expect(calls.map((call) => call.timeout)).toEqual([LIST_TIMEOUT_MS]);
  });

  it("fails with the engine's own reason instead of passing for an empty list", async () => {
    const { host } = fakeHost(surface, () => ({ status: 500, data: { message: "database is locked" } }));
    await expect(new Adapter(host).list()).rejects.toThrow(
      `Could not list ${what}: the engine answered 500 (database is locked)`,
    );
  });
});
