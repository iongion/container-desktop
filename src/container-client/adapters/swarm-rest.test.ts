import { describe, expect, it, vi } from "vitest";

import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { SwarmAdapter } from "./swarm";
import { listServices, listStacks, swarmInspect } from "./swarm-rest";

// A minimal fake Axios driver: only `get`/`post`/`delete` are exercised. Each returns a canned
// AxiosResponse-shaped object (or throws) so the pure swarm-rest logic is tested at the driver boundary
// — no real socket, no fakeCommand/ProxyRequest needed.
function fakeDriver(handlers: {
  get?: (url: string, cfg?: any) => Promise<any>;
  post?: (url: string, body?: any, cfg?: any) => Promise<any>;
  delete?: (url: string, cfg?: any) => Promise<any>;
}): any {
  return {
    get: handlers.get ?? (async () => ({ status: 200, data: [] })),
    post: handlers.post ?? (async () => ({ status: 200, data: {} })),
    delete: handlers.delete ?? (async () => ({ status: 200, data: {} })),
  };
}

const ok = (data: unknown) => ({ status: 200, data });
const notASwarmManager = () => {
  const error: any = new Error("This node is not a swarm manager.");
  error.response = { status: 503, data: { message: "This node is not a swarm manager." } };
  return error;
};

describe("swarm-rest — pure REST logic", () => {
  it("derives stacks by grouping services on the com.docker.stack.namespace label", async () => {
    const driver = fakeDriver({
      get: async (url) => {
        if (url === "/services") {
          return ok([
            { ID: "s1", Spec: { Name: "web_app", Labels: { "com.docker.stack.namespace": "web" } } },
            { ID: "s2", Spec: { Name: "web_db", Labels: { "com.docker.stack.namespace": "web" } } },
            { ID: "s3", Spec: { Name: "db_only", Labels: { "com.docker.stack.namespace": "db" } } },
            { ID: "s4", Spec: { Name: "loose", Labels: {} } }, // no namespace → not part of a stack
          ]);
        }
        return ok([]);
      },
    });
    const stacks = await listStacks(driver);
    expect(stacks).toHaveLength(2);
    const web = stacks.find((s) => s.Name === "web");
    const db = stacks.find((s) => s.Name === "db");
    expect(web).toMatchObject({ Name: "web", Services: 2, Orchestrator: "Swarm" });
    expect(db).toMatchObject({ Name: "db", Services: 1 });
  });

  it("maps the non-swarm 503 to an empty list (listServices)", async () => {
    const driver = fakeDriver({
      get: async () => {
        throw notASwarmManager();
      },
    });
    await expect(listServices(driver)).resolves.toEqual([]);
  });

  it("maps the non-swarm 503 to undefined (swarmInspect)", async () => {
    const driver = fakeDriver({
      get: async () => {
        throw notASwarmManager();
      },
    });
    await expect(swarmInspect(driver)).resolves.toBeUndefined();
  });

  it("rethrows non-swarm errors (500 / auth / network) so the global error path surfaces them", async () => {
    const boom: any = new Error("server exploded");
    boom.response = { status: 500, data: { message: "boom" } };
    const driver = fakeDriver({
      get: async () => {
        throw boom;
      },
    });
    await expect(listServices(driver)).rejects.toThrow("server exploded");
  });

  it("returns the service list on success", async () => {
    const driver = fakeDriver({
      get: async (url) => (url === "/services" ? ok([{ ID: "s1" }, { ID: "s2" }]) : ok([])),
    });
    await expect(listServices(driver)).resolves.toHaveLength(2);
  });
});

describe("SwarmAdapter — capability gate (not API-shape)", () => {
  it("returns [] WITHOUT touching the driver when extensions.swarm is false (e.g. Apple Container, apiSurface 'docker')", async () => {
    const getApiDriver = vi.fn(async () => fakeDriver({}));
    const host = {
      apiSurface: "docker",
      capabilities: { extensions: { swarm: false } },
      getApiDriver,
    } as unknown as HostClientFacade;

    const adapter = new SwarmAdapter(host);
    await expect(adapter.listServices()).resolves.toEqual([]);
    expect(getApiDriver).not.toHaveBeenCalled();
  });

  it("delegates to the driver when extensions.swarm is true", async () => {
    const getApiDriver = vi.fn(async () =>
      fakeDriver({ get: async (url: string) => (url === "/services" ? ok([{ ID: "svc" }]) : ok([])) }),
    );
    const host = {
      apiSurface: "docker",
      capabilities: { extensions: { swarm: true } },
      getApiDriver,
    } as unknown as HostClientFacade;

    const adapter = new SwarmAdapter(host);
    await expect(adapter.listServices()).resolves.toEqual([{ ID: "svc" }]);
    expect(getApiDriver).toHaveBeenCalledOnce();
  });
});
