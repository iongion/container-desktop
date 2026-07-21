import { describe, expect, it, vi } from "vitest";

import { composeUp, resolvePaths } from "./orchestrate";
import type { ComposeMount, ComposeProjectModel } from "./types";

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

describe("orchestrate resolvePaths", () => {
  it("resolves a bind source absolute against projectDir, then via the injected guest resolver", async () => {
    const resolvePath = vi.fn(async (p: string) => `/guest${p}`);
    const out = await resolvePaths(model([{ type: "bind", source: "./data", target: "/d" }]), resolvePath);
    expect(resolvePath).toHaveBeenCalledWith("/work/proj/data");
    expect(out.services[0].mounts[0].source).toBe("/guest/work/proj/data");
  });

  it("does not guest-translate named-volume mounts", async () => {
    const resolvePath = vi.fn(async (p: string) => `/guest${p}`);
    const out = await resolvePaths(model([{ type: "volume", source: "data", target: "/d" }]), resolvePath);
    expect(resolvePath).not.toHaveBeenCalled();
    expect(out.services[0].mounts[0].source).toBe("data");
  });
});

describe("orchestrate composeUp", () => {
  it("resolves paths, translates and applies the plan", async () => {
    const posts: string[] = [];
    const driver: any = {
      get: async () => ({ status: 200, data: [] }),
      post: async (url: string) => {
        posts.push(url);
        return { status: 201, data: { Id: "x" } };
      },
      delete: async () => ({ status: 200, data: {} }),
    };
    const summary = await composeUp(driver, model([]), {}, { resolvePath: async (p) => p });
    expect(posts).toContain("/containers/create");
    expect(summary.created).toContain("proj_web_1");
  });
});
