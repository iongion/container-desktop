import { describe, expect, it, vi } from "vitest";

import type { ComposeMount, ComposeProjectModel } from "@/container-client/compose/types";
import { ComposeAdapter } from "./compose";

const fakeDriver = () => ({
  get: async () => ({ status: 200, data: [] }),
  post: async () => ({ status: 201, data: { Id: "x" } }),
  delete: async () => ({ status: 200, data: {} }),
});

const model = (mounts: ComposeMount[]): ComposeProjectModel => ({
  name: "proj",
  projectDir: "/work/proj",
  services: [
    {
      name: "web",
      image: "img",
      environment: {},
      ports: [],
      mounts,
      networks: [{ name: "default", aliases: [] }],
      dependsOn: [],
      healthDeps: [],
      labels: {},
      profiles: [],
      expose: [],
      capAdd: [],
      capDrop: [],
      extraHosts: [],
    },
  ],
  networks: [{ name: "default" }],
  volumes: [],
  unsupported: [],
});

describe("ComposeAdapter", () => {
  it("up() resolves bind sources through host.resolveGuestPath (scope from settings) then drives the engine", async () => {
    const resolveGuestPath = vi.fn(async (p: string) => `/mnt/wsl${p}`);
    const host: any = {
      getApiDriver: async () => fakeDriver(),
      getSettings: async () => ({ controller: { scope: "Ubuntu" } }),
      resolveGuestPath,
    };
    const summary = await new ComposeAdapter(host).up(model([{ type: "bind", source: "./data", target: "/d" }]), {});
    expect(resolveGuestPath).toHaveBeenCalledWith("/work/proj/data", "Ubuntu", expect.anything());
    expect(summary.created).toContain("proj_web_1");
  });

  it("down() delegates the teardown through the driver", async () => {
    const host: any = {
      getApiDriver: async () => fakeDriver(),
      getSettings: async () => ({}),
      resolveGuestPath: async (p: string) => p,
    };
    await expect(new ComposeAdapter(host).down("proj", {})).resolves.toBeUndefined();
  });
});
