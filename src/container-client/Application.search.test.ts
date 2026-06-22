import { describe, expect, it } from "vitest";

import { Application } from "@/container-client/Application";
import { ContainerEngine, OperatingSystem, type Registry } from "@/env/Types";

// The constructor leaves `this.logger` unset (it's only assigned in setup()), and searchRegistry logs
// immediately — install a stub logger so tests fail on real assertions, not on an undefined logger.
const STUB_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };

function makeApp(): any {
  const app = new Application({
    osType: OperatingSystem.Linux,
    version: "test",
    environment: "test",
    messageBus: {} as any,
  }) as any;
  app.logger = STUB_LOGGER;
  return app;
}

const reg = (id: string, name: string) => ({ id, name }) as Registry;

describe("Application.searchRegistry", () => {
  it("podman system registry: API search with ordered params, normalized + sorted results", async () => {
    const app = makeApp();
    let capturedUrl = "";
    const host = {
      ENGINE: ContainerEngine.PODMAN,
      getSettings: async () => ({ program: { name: "podman", path: "" } }),
      getApiDriver: async () => ({
        request: async (req: any) => {
          capturedUrl = req.url;
          return {
            data: [
              { Name: "bravo", StarCount: 3 },
              { Name: "alpha", Stars: 9 },
            ],
          };
        },
      }),
      isScoped: () => false,
    };

    const out = await app.searchRegistry({
      term: "ng",
      registry: reg("system", "system"),
      filters: { isOfficial: true, isAutomated: true },
      host,
    });

    expect(capturedUrl).toBe("/images/search?term=ng&is-automated=true&is-official=true");
    expect(out.map((it: any) => it.Name)).toEqual(["alpha", "bravo"]); // sorted by stars desc
    expect(out[1].Stars).toBe(3); // derived from StarCount
  });

  it("podman CLI (non-system registry): builds filtered args and parses JSON", async () => {
    const app = makeApp();
    let capturedArgs: string[] = [];
    const host = {
      ENGINE: ContainerEngine.PODMAN,
      getSettings: async () => ({ program: { name: "podman", path: "/usr/bin/podman" } }),
      isScoped: () => false,
      runHostCommand: async (_program: string, args: string[]) => {
        capturedArgs = args;
        return { success: true, stdout: JSON.stringify([{ Name: "x", Stars: 1 }]) };
      },
    };

    const out = await app.searchRegistry({
      term: "redis",
      registry: reg("quay.io", "quay.io"),
      filters: { isOfficial: true },
      host,
    });

    expect(capturedArgs).toEqual(["search", "--filter=is-official", "quay.io/redis", "--format", "json"]);
    expect(out).toHaveLength(1);
  });

  it("docker: parses multi-line JSON output and sorts", async () => {
    const app = makeApp();
    let capturedArgs: string[] = [];
    const host = {
      ENGINE: ContainerEngine.DOCKER,
      getSettings: async () => ({ program: { name: "docker", path: "" } }),
      isScoped: () => false,
      runHostCommand: async (_program: string, args: string[]) => {
        capturedArgs = args;
        return { success: true, stdout: '{"Name":"bbb","StarCount":2}\n{"Name":"aaa","StarCount":8}' };
      },
    };

    const out = await app.searchRegistry({ term: "db", registry: reg("docker.io", "docker.io"), filters: {}, host });

    expect(capturedArgs).toEqual(["search", "--format", "json", "db"]);
    expect(out.map((it: any) => it.Name)).toEqual(["aaa", "bbb"]);
    expect(out[0].Stars).toBe(8);
  });

  it("apple: API search succeeds and never sends is-automated", async () => {
    const app = makeApp();
    let capturedUrl = "";
    const host = {
      ENGINE: ContainerEngine.APPLE,
      getSettings: async () => ({ program: { name: "container", path: "" } }),
      getApiDriver: async () => ({
        request: async (req: any) => {
          capturedUrl = req.url;
          return { data: [{ Name: "img", Stars: 2 }] };
        },
      }),
      isScoped: () => false,
    };

    const out = await app.searchRegistry({
      term: "x",
      registry: reg("docker.io", "docker.io"),
      filters: { isOfficial: true, isAutomated: true },
      host,
    });

    expect(capturedUrl).toBe("/images/search?term=x&is-official=true");
    expect(out).toHaveLength(1);
  });

  it("apple: a socktainer 404 degrades to empty results", async () => {
    const app = makeApp();
    const host = {
      ENGINE: ContainerEngine.APPLE,
      getSettings: async () => ({ program: { name: "container", path: "" } }),
      getApiDriver: async () => ({
        request: async () => {
          throw new Error("404 no such endpoint");
        },
      }),
      isScoped: () => false,
    };

    const out = await app.searchRegistry({ term: "x", registry: reg("docker.io", "docker.io"), filters: {}, host });
    expect(out).toEqual([]);
  });

  it("scoped host: runs the search inside the controller scope", async () => {
    const app = makeApp();
    let scopedWith: string | undefined;
    const host = {
      ENGINE: ContainerEngine.PODMAN,
      getSettings: async () => ({ program: { name: "podman", path: "/p" }, controller: { scope: "wsl-distro" } }),
      isScoped: () => true,
      runScopeCommand: async (_program: string, _args: string[], scope: string) => {
        scopedWith = scope;
        return { success: true, stdout: "[]" };
      },
    };

    await app.searchRegistry({ term: "x", registry: reg("quay.io", "quay.io"), filters: {}, host });
    expect(scopedWith).toBe("wsl-distro");
  });
});
