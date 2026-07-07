import { describe, expect, it, vi } from "vitest";

import type { ComposeMount, ComposeProjectModel } from "@/container-client/compose/types";
import { ContainerEngine } from "@/env/Types";
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

  // Docker branch — shells `docker compose` (no libpod), guest-resolving the file path, after a version probe.
  const dockerHost = (runHostCommand: any): any => ({
    ENGINE: ContainerEngine.DOCKER,
    isScoped: () => false,
    getSettings: async () => ({ program: { path: "docker" } }),
    resolveGuestPath: async (p: string) => p,
    runHostCommand,
  });

  it("up() on Docker probes `docker compose version`, then shells `docker compose -f <file> -p <name> up -d`", async () => {
    const runHostCommand = vi.fn(async (_program: string, args: string[]) => {
      if (args.includes("version")) {
        return { success: true, stdout: "Docker Compose version v2.29.0", stderr: "" };
      }
      return {
        success: true,
        stdout: "",
        stderr: " ✔ Container proj-web-1  Created\n ✔ Container proj-web-1  Started",
      };
    });
    const summary = await new ComposeAdapter(dockerHost(runHostCommand)).up(
      model([]),
      {},
      {
        path: "/work/proj/docker-compose.yml",
      },
    );
    expect(runHostCommand).toHaveBeenNthCalledWith(1, "docker", ["compose", "version"], expect.anything());
    expect(runHostCommand).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["compose", "-f", "/work/proj/docker-compose.yml", "-p", "proj", "up", "-d"],
      expect.anything(),
    );
    expect(summary.created).toEqual(["proj-web-1"]);
    expect(summary.started).toEqual(["proj-web-1"]);
  });

  it("up() on Docker throws a clear error when the compose v2 plugin is missing", async () => {
    const runHostCommand = vi.fn(async () => ({ success: false, stdout: "", stderr: "not a docker command" }));
    await expect(new ComposeAdapter(dockerHost(runHostCommand)).up(model([]), {}, { path: "/c.yml" })).rejects.toThrow(
      /Docker Compose v2/,
    );
  });

  it("up() on Docker requires a compose file path", async () => {
    const runHostCommand = vi.fn(async () => ({ success: true, stdout: "", stderr: "" }));
    await expect(new ComposeAdapter(dockerHost(runHostCommand)).up(model([]), {})).rejects.toThrow(/compose file/i);
  });

  it("down() on Docker shells `docker compose -p <project> down`, adding -v for volumes", async () => {
    const runHostCommand = vi.fn(async () => ({ success: true, stdout: "", stderr: "" }));
    await new ComposeAdapter(dockerHost(runHostCommand)).down("proj", { removeVolumes: true });
    expect(runHostCommand).toHaveBeenCalledWith("docker", ["compose", "-p", "proj", "down", "-v"], expect.anything());
  });
});
