import { describe, expect, it } from "vitest";

import type { ComposePlan } from "@/container-client/compose/types";
import { applyPlan, down, listProjects, startContainer, waitHealthy } from "./compose-rest";

// Recording fake Axios driver — mirrors swarm-rest.test.ts (no real socket, no fakeCommand). It logs
// every mutation and returns the canned `/containers/json` list so reconcile can be asserted at the boundary.
interface Call {
  method: "get" | "post" | "delete";
  url: string;
  config?: any;
}
function recordingDriver(containers: unknown[] = [], extras: { networks?: unknown[]; volumes?: unknown[] } = {}) {
  const calls: Call[] = [];
  const driver: any = {
    get: async (url: string, config?: any) => {
      calls.push({ method: "get", url, config });
      if (url.startsWith("/containers/json")) return { status: 200, data: containers };
      if (url.startsWith("/networks/json")) return { status: 200, data: extras.networks ?? [] };
      if (url.startsWith("/volumes/json")) return { status: 200, data: extras.volumes ?? [] };
      return { status: 200, data: [] };
    },
    post: async (url: string, _body?: any, config?: any) => {
      calls.push({ method: "post", url, config });
      return { status: 201, data: { Id: `id-${calls.length}` } };
    },
    delete: async (url: string, config?: any) => {
      calls.push({ method: "delete", url, config });
      return { status: 200, data: {} };
    },
  };
  return { driver, calls };
}

const container = (name: string, service: string, hash: string, state = "running", pod?: string) => ({
  Id: `cid-${name}`,
  Names: [name],
  State: state,
  Pod: pod,
  Labels: {
    "com.docker.compose.project": "proj",
    "com.docker.compose.service": service,
    "com.docker.compose.config-hash": hash,
  },
});

const planContainer = (service: string, hash: string) => ({
  name: `proj_${service}_1`,
  service,
  configHash: hash,
  body: { name: `proj_${service}_1`, image: "img", labels: {} },
});

const plan = (over: Partial<ComposePlan> = {}): ComposePlan => ({
  project: "proj",
  networks: [{ name: "proj_default", body: { name: "proj_default" } }],
  volumes: [{ name: "proj_data", body: { Name: "proj_data" } }],
  containers: [planContainer("db", "h-db"), planContainer("web", "h-web")],
  startOrder: ["proj_db_1", "proj_web_1"],
  warnings: [],
  ...over,
});

const posts = (calls: Call[]) => calls.filter((c) => c.method === "post").map((c) => c.url);

describe("compose-rest applyPlan — reconcile", () => {
  it("fresh up: creates network, volume, containers (not started during reconcile), then starts in order", async () => {
    const { driver, calls } = recordingDriver([]);
    const summary = await applyPlan(driver, plan());
    const p = posts(calls);
    expect(p).toContain("/networks/create");
    expect(p).toContain("/volumes/create");
    expect(p.filter((u) => u === "/containers/create")).toHaveLength(2);
    // start pass happens AFTER both creates, in startOrder
    const dbStart = p.indexOf("/containers/proj_db_1/start");
    const webStart = p.indexOf("/containers/proj_web_1/start");
    expect(dbStart).toBeGreaterThan(-1);
    expect(dbStart).toBeLessThan(webStart);
    expect(summary.created).toEqual(["proj_db_1", "proj_web_1"]);
  });

  it("unchanged: same config-hash and running → no create, no start", async () => {
    const existing = [container("proj_db_1", "db", "h-db"), container("proj_web_1", "web", "h-web")];
    const { driver, calls } = recordingDriver(existing);
    const summary = await applyPlan(driver, plan());
    expect(posts(calls)).not.toContain("/containers/create");
    expect(posts(calls).some((u) => u.endsWith("/start"))).toBe(false);
    expect(summary.unchanged.sort()).toEqual(["proj_db_1", "proj_web_1"]);
    expect(summary.started).toEqual([]);
  });

  it("changed config-hash → remove old + create new + start", async () => {
    const existing = [container("proj_db_1", "db", "OLD"), container("proj_web_1", "web", "h-web")];
    const { driver, calls } = recordingDriver(existing);
    const summary = await applyPlan(driver, plan());
    expect(calls.some((c) => c.method === "delete" && c.url.includes("cid-proj_db_1"))).toBe(true);
    expect(posts(calls).filter((u) => u === "/containers/create")).toHaveLength(1);
    expect(summary.recreated).toEqual(["proj_db_1"]);
    expect(summary.started).toEqual(["proj_db_1"]);
  });

  it("matches existing containers by compose labels even when container_name differs", async () => {
    // existing container has a custom name but the same service label + matching hash → unchanged, not recreated
    const existing = [container("totally-custom", "web", "h-web")];
    const { driver, calls } = recordingDriver(existing);
    const summary = await applyPlan(
      driver,
      plan({ containers: [planContainer("web", "h-web")], startOrder: ["proj_web_1"] }),
    );
    expect(posts(calls)).not.toContain("/containers/create");
    expect(summary.unchanged).toEqual(["proj_web_1"]);
  });

  it("removes orphans only when removeOrphans is set", async () => {
    const existing = [container("proj_web_1", "web", "h-web"), container("proj_old_1", "old", "h-old")];
    const withoutFlag = recordingDriver(existing);
    const s1 = await applyPlan(
      withoutFlag.driver,
      plan({ containers: [planContainer("web", "h-web")], startOrder: ["proj_web_1"] }),
    );
    expect(s1.orphansRemoved).toEqual([]);

    const withFlag = recordingDriver(existing);
    const s2 = await applyPlan(
      withFlag.driver,
      plan({ containers: [planContainer("web", "h-web")], startOrder: ["proj_web_1"] }),
      { removeOrphans: true },
    );
    expect(s2.orphansRemoved).toEqual(["proj_old_1"]);
    expect(withFlag.calls.some((c) => c.method === "delete" && c.url.includes("cid-proj_old_1"))).toBe(true);
  });
});

describe("compose-rest applyPlan — mode switch (pod ↔ no-pod)", () => {
  it("tears the project down first when the existing stack is pod-mode but the plan is not", async () => {
    const existing = [container("proj_web_1", "web", "h-web", "running", "proj")]; // pod member
    const { driver, calls } = recordingDriver(existing);
    await applyPlan(driver, plan()); // plan() has no pod
    // The mode switch routes removal through a clean, pod-safe down() — which deletes the pod.
    expect(calls.some((c) => c.method === "delete" && c.url.startsWith("/pods/proj"))).toBe(true);
  });

  it("tears the project down first when the existing stack is standalone but the plan is pod-mode", async () => {
    const existing = [container("proj_web_1", "web", "h-web")]; // no pod
    const { driver, calls } = recordingDriver(existing);
    await applyPlan(driver, plan({ pod: { name: "proj", body: { name: "proj" } } }));
    expect(calls.some((c) => c.method === "delete" && c.url.startsWith("/pods/proj"))).toBe(true);
  });

  it("does NOT tear down when the deployment mode is unchanged", async () => {
    const existing = [container("proj_web_1", "web", "h-web")]; // no pod, plan has no pod
    const { driver, calls } = recordingDriver(existing);
    await applyPlan(driver, plan());
    expect(calls.some((c) => c.method === "delete" && c.url.startsWith("/pods/"))).toBe(false);
  });
});

describe("compose-rest down", () => {
  it("removes project containers, the project pod (ignoring 404), and networks; volumes only with removeVolumes", async () => {
    const existing = [container("proj_web_1", "web", "h-web")];
    const { driver, calls } = recordingDriver(existing);
    await down(driver, "proj", {});
    expect(calls.some((c) => c.method === "delete" && c.url.includes("cid-proj_web_1"))).toBe(true);
    expect(calls.some((c) => c.method === "delete" && c.url.startsWith("/pods/proj"))).toBe(true);
    // no volume deletion without the flag
    expect(calls.some((c) => c.method === "delete" && c.url.startsWith("/volumes/"))).toBe(false);
  });

  it("removes named volumes when removeVolumes is set", async () => {
    const { driver, calls } = recordingDriver([]);
    await down(driver, "proj", { removeVolumes: true });
    expect(calls.some((c) => c.method === "get" && c.url.startsWith("/volumes/json"))).toBe(true);
  });

  it("deletes libpod networks, whose list uses a lowercase `name` key (not docker's `Name`)", async () => {
    const { driver, calls } = recordingDriver([container("proj_web_1", "web", "h-web")], {
      networks: [
        { name: "proj_default", labels: { "com.docker.compose.project": "proj" } },
        { name: "proj_backend", labels: { "com.docker.compose.project": "proj" } },
      ],
    });
    await down(driver, "proj", {});
    const deletes = calls.filter((c) => c.method === "delete").map((c) => c.url);
    expect(deletes).toContain("/networks/proj_default");
    expect(deletes).toContain("/networks/proj_backend");
  });

  it("still deletes libpod volumes, whose list uses an uppercase `Name` key", async () => {
    const { driver, calls } = recordingDriver([], { volumes: [{ Name: "proj_data" }] });
    await down(driver, "proj", { removeVolumes: true });
    const deletes = calls.filter((c) => c.method === "delete").map((c) => c.url);
    expect(deletes).toContain("/volumes/proj_data");
  });

  it("gives destructive deletes a generous timeout so a slow container stop isn't cut off at the 3s default", async () => {
    const { driver, calls } = recordingDriver([container("proj_web_1", "web", "h-web")]);
    await down(driver, "proj", {});
    const del = calls.find((c) => c.method === "delete" && c.url.includes("cid-proj_web_1"));
    expect(del?.config?.timeout).toBe(60000);
  });

  it("removes the project pod BEFORE any member container (force-removing pod members individually can crash podman)", async () => {
    const { driver, calls } = recordingDriver([container("proj_web_1", "web", "h-web")]);
    await down(driver, "proj", {});
    const deletes = calls.filter((c) => c.method === "delete").map((c) => c.url);
    const podIdx = deletes.findIndex((u) => u.startsWith("/pods/proj"));
    const containerIdx = deletes.findIndex((u) => u.includes("cid-proj_web_1"));
    expect(podIdx).toBeGreaterThanOrEqual(0);
    expect(containerIdx).toBeGreaterThanOrEqual(0);
    expect(podIdx).toBeLessThan(containerIdx);
  });
});

// Programmable driver for startContainer recovery: `failTimes` start POSTs reject with libpod's
// "container state improper" 500; GET /json returns the next {status, running} from `states`.
function startDriver({
  failTimes = 0,
  states = [{ status: "created", running: false }],
}: {
  failTimes?: number;
  states?: { status: string; running: boolean }[];
} = {}) {
  const calls: Call[] = [];
  let startCalls = 0;
  let stateIdx = 0;
  const driver: any = {
    get: async (url: string) => {
      calls.push({ method: "get", url });
      if (/\/containers\/[^/]+\/json$/.test(url)) {
        const s = states[Math.min(stateIdx, states.length - 1)];
        stateIdx += 1;
        return { status: 200, data: { State: { Status: s.status, Running: s.running } } };
      }
      return { status: 200, data: [] };
    },
    post: async (url: string) => {
      calls.push({ method: "post", url });
      if (/\/start$/.test(url)) {
        startCalls += 1;
        if (startCalls <= failTimes) {
          const err: any = new Error("boom");
          err.response = {
            status: 500,
            data: {
              cause: "container state improper",
              message: "container c must be in Created or Stopped state to be started: container state improper",
            },
          };
          throw err;
        }
      }
      return { status: 200, data: {} };
    },
  };
  return { driver, calls, startCount: () => startCalls };
}

describe("compose-rest startContainer", () => {
  it("starts a startable container with a single POST", async () => {
    const { driver, startCount } = startDriver({ failTimes: 0 });
    await expect(startContainer(driver, "c", { intervalMs: 0, timeoutMs: 100 })).resolves.toBeUndefined();
    expect(startCount()).toBe(1);
  });

  it("treats an already-running container as started when libpod reports 'state improper'", async () => {
    const { driver, startCount } = startDriver({ failTimes: 1, states: [{ status: "running", running: true }] });
    await expect(startContainer(driver, "c", { intervalMs: 0, timeoutMs: 100 })).resolves.toBeUndefined();
    expect(startCount()).toBe(1); // no second start — it was already up
  });

  it("waits for a leftover 'stopping' container to settle, then starts it", async () => {
    const { driver, startCount } = startDriver({
      failTimes: 1,
      states: [
        { status: "stopping", running: false },
        { status: "exited", running: false },
      ],
    });
    await expect(startContainer(driver, "c", { intervalMs: 0, timeoutMs: 1000 })).resolves.toBeUndefined();
    expect(startCount()).toBe(2); // failed once while stopping, started once it reached exited
  });

  it("surfaces a clear error (not the raw libpod message) when it never becomes startable", async () => {
    const { driver } = startDriver({ failTimes: 1, states: [{ status: "paused", running: false }] });
    await expect(startContainer(driver, "c", { intervalMs: 0, timeoutMs: 0 })).rejects.toThrow(
      /stuck in state "paused"/,
    );
  });

  it("rethrows a start error that is not 'state improper' unchanged", async () => {
    const driver: any = {
      post: async () => {
        const err: any = new Error("no such image");
        err.response = { status: 404, data: { message: "no such image" } };
        throw err;
      },
      get: async () => ({ status: 200, data: {} }),
    };
    await expect(startContainer(driver, "c", { intervalMs: 0, timeoutMs: 0 })).rejects.toThrow(/no such image/);
  });
});

const inspectHealthDriver = (statuses: (string | null)[]) => {
  let index = 0;
  const calls: Call[] = [];
  const driver: any = {
    get: async (url: string) => {
      calls.push({ method: "get", url });
      if (url.startsWith("/containers/json")) return { status: 200, data: [] };
      if (url.includes("/json")) {
        const status = statuses[Math.min(index, statuses.length - 1)];
        index += 1;
        return { status: 200, data: { State: status === null ? {} : { Health: { Status: status } } } };
      }
      return { status: 200, data: [] };
    },
    post: async (url: string) => {
      calls.push({ method: "post", url });
      return { status: 201, data: { Id: `id-${calls.length}` } };
    },
    delete: async (url: string) => {
      calls.push({ method: "delete", url });
      return { status: 200, data: {} };
    },
  };
  return { driver, calls };
};

describe("compose-rest waitHealthy", () => {
  it("resolves once inspect reports healthy (starting → starting → healthy)", async () => {
    const { driver } = inspectHealthDriver(["starting", "starting", "healthy"]);
    await expect(waitHealthy(driver, "proj_db_1", { intervalMs: 0, timeoutMs: 2000 })).resolves.toBeUndefined();
  });

  it("throws a descriptive timeout naming the container when it never becomes healthy", async () => {
    const { driver } = inspectHealthDriver(["starting"]);
    await expect(waitHealthy(driver, "proj_db_1", { intervalMs: 0, timeoutMs: 0 })).rejects.toThrow(/proj_db_1/);
  });

  it("throws a clear error when the gated dependency has no healthcheck (State.Health absent)", async () => {
    const { driver } = inspectHealthDriver([null]);
    await expect(waitHealthy(driver, "proj_db_1", { intervalMs: 0, timeoutMs: 2000 })).rejects.toThrow(
      /no healthcheck/i,
    );
  });
});

describe("compose-rest applyPlan — service_healthy gate", () => {
  it("waits for a gated dep to be healthy before starting the dependent (start order preserved)", async () => {
    const { driver, calls } = inspectHealthDriver(["starting", "healthy"]);
    const gatedPlan = plan({ healthGates: { proj_web_1: ["proj_db_1"] } });
    await applyPlan(driver, gatedPlan, {}, { intervalMs: 0, timeoutMs: 2000 });
    const seq = calls.filter((c) => c.method === "post" || (c.method === "get" && c.url.includes("/proj_db_1/json")));
    const dbStart = seq.findIndex((c) => c.url === "/containers/proj_db_1/start");
    const firstHealthPoll = seq.findIndex((c) => c.method === "get" && c.url.includes("/proj_db_1/json"));
    const webStart = seq.findIndex((c) => c.url === "/containers/proj_web_1/start");
    // db starts, then we poll db health, and only then does web start.
    expect(dbStart).toBeGreaterThanOrEqual(0);
    expect(firstHealthPoll).toBeGreaterThan(dbStart);
    expect(webStart).toBeGreaterThan(firstHealthPoll);
  });

  it("fails the up with a descriptive error if a gated dep never becomes healthy", async () => {
    const { driver } = inspectHealthDriver(["starting"]);
    const gatedPlan = plan({ healthGates: { proj_web_1: ["proj_db_1"] } });
    await expect(applyPlan(driver, gatedPlan, {}, { intervalMs: 0, timeoutMs: 0 })).rejects.toThrow(/proj_db_1/);
  });
});

describe("compose-rest listProjects", () => {
  it("groups containers by compose project label with service + running counts", async () => {
    const existing = [
      container("proj_web_1", "web", "h", "running"),
      container("proj_db_1", "db", "h", "exited"),
      { Id: "x", Names: ["loose"], State: "running", Labels: {} },
    ];
    const { driver } = recordingDriver(existing);
    const projects = await listProjects(driver);
    expect(projects).toEqual([{ Name: "proj", Services: 2, Running: 1, PodMode: false }]);
  });

  it("recognizes podman-compose's io.podman.compose.* labels (not just com.docker.compose.*)", async () => {
    const existing = [
      {
        Id: "a",
        Names: ["p_web_1"],
        State: "running",
        Labels: { "io.podman.compose.project": "p", "io.podman.compose.service": "web" },
      },
      {
        Id: "b",
        Names: ["p_db_1"],
        State: "running",
        Labels: { "io.podman.compose.project": "p", "io.podman.compose.service": "db" },
      },
    ];
    const { driver } = recordingDriver(existing);
    const projects = await listProjects(driver);
    expect(projects).toEqual([{ Name: "p", Services: 2, Running: 2, PodMode: false }]);
  });
});
