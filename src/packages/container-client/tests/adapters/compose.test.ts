import { describe, expect, it, vi } from "vitest";
import { ComposeAdapter } from "@/container-client/adapters/compose";
import type { ComposeMount, ComposeProjectModel } from "@/container-client/compose/types";
import { ContainerEngine } from "@/container-client/types/engine";

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

  // A connection pinned to a Docker context deploys to THAT engine, as every other docker call of the connection does.
  it("pins `docker compose` to the connection's Docker context", async () => {
    const runHostCommand = vi.fn(async () => ({ success: true, stdout: "", stderr: "" }));
    const host = {
      ...dockerHost(runHostCommand),
      getSettings: async () => ({ program: { path: "docker" }, context: "colima" }),
    };
    await new ComposeAdapter(host).down("proj");
    expect(runHostCommand).toHaveBeenCalledWith(
      "docker",
      ["--context", "colima", "compose", "-p", "proj", "down"],
      expect.anything(),
    );
  });

  // Apple: the Docker CLI's compose, aimed at the socktainer socket (Apple's own `container` has no compose).
  const appleHost = (runHostCommand: any): any => ({
    ENGINE: ContainerEngine.APPLE,
    isScoped: () => false,
    getSettings: async () => ({
      program: { path: "/usr/local/bin/container" },
      api: { connection: { uri: "/Users/me/.socktainer/container.sock", relay: "" } },
    }),
    resolveGuestPath: async (p: string) => p,
    runHostCommand,
  });

  it("up() on Apple shells the Docker CLI's compose against the socktainer socket", async () => {
    const runHostCommand = vi.fn(async () => ({ success: true, stdout: "", stderr: "" }));
    await new ComposeAdapter(appleHost(runHostCommand)).up(model([]), {}, { path: "/work/proj/compose.yml" });
    const target = ["--host", "unix:///Users/me/.socktainer/container.sock"];
    expect(runHostCommand).toHaveBeenNthCalledWith(1, "docker", [...target, "compose", "version"], expect.anything());
    expect(runHostCommand).toHaveBeenNthCalledWith(
      2,
      "docker",
      [...target, "compose", "-f", "/work/proj/compose.yml", "-p", "proj", "up", "-d"],
      expect.anything(),
    );
  });

  it("up() on Apple says the Docker CLI's compose is needed when it is missing", async () => {
    const runHostCommand = vi.fn(async () => ({ success: false, stdout: "", stderr: "command not found: docker" }));
    await expect(new ComposeAdapter(appleHost(runHostCommand)).up(model([]), {}, { path: "/c.yml" })).rejects.toThrow(
      /Apple Container.*Docker CLI/,
    );
  });

  it("down() on Apple tears the stack down through the same CLI", async () => {
    const runHostCommand = vi.fn(async () => ({ success: true, stdout: "", stderr: "" }));
    await new ComposeAdapter(appleHost(runHostCommand)).down("proj");
    expect(runHostCommand).toHaveBeenCalledWith(
      "docker",
      ["--host", "unix:///Users/me/.socktainer/container.sock", "compose", "-p", "proj", "down"],
      expect.anything(),
    );
  });
});
