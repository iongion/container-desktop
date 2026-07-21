import { describe, expect, it } from "vitest";

import { detectPodPortConflicts, translate } from "./translate";
import type { ComposeProjectModel, ComposeServiceModel } from "./types";

const service = (name: string, over: Partial<ComposeServiceModel> = {}): ComposeServiceModel => ({
  name,
  image: "img",
  environment: {},
  ports: [],
  mounts: [],
  networks: [{ name: "default", aliases: [] }],
  dependsOn: [],
  healthDeps: [],
  labels: {},
  profiles: [],
  expose: [],
  capAdd: [],
  capDrop: [],
  extraHosts: [],
  ...over,
});

const model = (services: ComposeServiceModel[], over: Partial<ComposeProjectModel> = {}): ComposeProjectModel => ({
  name: "proj",
  projectDir: "/p",
  services,
  networks: [{ name: "default" }],
  volumes: [],
  unsupported: [],
  ...over,
});

const containerFor = (plan: ReturnType<typeof translate>, svc: string) =>
  plan.containers.find((c) => c.service === svc)!;

describe("translate — naming & labels", () => {
  it("names containers <project>_<service>_1, honoring container_name", () => {
    const plan = translate(model([service("web"), service("db", { containerName: "the-db" })]), {});
    expect(containerFor(plan, "web").name).toBe("proj_web_1");
    expect(containerFor(plan, "db").name).toBe("the-db");
  });

  it("writes the compose grouping labels on every container", () => {
    const labels = containerFor(translate(model([service("web")]), {}), "web").body.labels as Record<string, string>;
    expect(labels["com.docker.compose.project"]).toBe("proj");
    expect(labels["com.docker.compose.service"]).toBe("web");
    expect(labels["com.docker.compose.container-number"]).toBe("1");
    expect(labels["io.podman.compose.project"]).toBe("proj");
  });
});

describe("translate — default (compose-parity) mode", () => {
  it("emits portmappings and per-container Networks with the service name as an alias", () => {
    const web = service("web", {
      ports: [{ target: 80, published: "8080", protocol: "tcp" }],
      networks: [{ name: "default", aliases: ["front"] }],
    });
    const body = containerFor(translate(model([web]), {}), "web").body;
    expect(body.portmappings).toEqual([{ container_port: 80, host_port: 8080, protocol: "tcp" }]);
    expect(body.Networks).toEqual({ proj_default: { aliases: ["web", "front"] } });
    expect(body.pod).toBeUndefined();
  });

  it("maps bind mounts to mounts[] and named volumes to project-scoped volumes[]", () => {
    const web = service("web", {
      mounts: [
        { type: "bind", source: "/abs", target: "/mnt", readOnly: true },
        { type: "volume", source: "data", target: "/var/lib" },
      ],
    });
    const body = containerFor(translate(model([web]), {}), "web").body;
    expect(body.mounts).toEqual([{ type: "bind", source: "/abs", destination: "/mnt", options: ["ro"] }]);
    expect(body.volumes).toEqual([{ Name: "proj_data", Dest: "/var/lib" }]);
  });

  it("maps compose restart to a libpod restart_policy", () => {
    const body = containerFor(translate(model([service("web", { restart: "unless-stopped" })]), {}), "web").body;
    expect(body.restart_policy).toBe("unless-stopped");
  });
});

describe("translate — project resources", () => {
  it("creates the project default + declared networks, skipping external ones", () => {
    const plan = translate(
      model([service("web")], {
        networks: [{ name: "default" }, { name: "backend" }, { name: "ext", external: true }],
      }),
      {},
    );
    expect(plan.networks.map((n) => n.name).sort()).toEqual(["proj_backend", "proj_default"]);
  });

  it("creates project-scoped named volumes, skipping external ones", () => {
    const plan = translate(
      model([service("web")], { volumes: [{ name: "data" }, { name: "ext", external: true }] }),
      {},
    );
    expect(plan.volumes.map((v) => v.name)).toEqual(["proj_data"]);
  });
});

describe("translate — start order & config-hash", () => {
  it("orders start by depends_on (container names)", () => {
    const plan = translate(model([service("web", { dependsOn: ["db"] }), service("db")]), {});
    expect(plan.startOrder).toEqual(["proj_db_1", "proj_web_1"]);
  });

  it("stamps a config-hash label; equal specs hash equal, changed specs differ", () => {
    const a = translate(model([service("web")]), {});
    const b = translate(model([service("web")]), {});
    const c = translate(model([service("web", { image: "other" })]), {});
    const hashOf = (p: ReturnType<typeof translate>) =>
      (containerFor(p, "web").body.labels as Record<string, string>)["com.docker.compose.config-hash"];
    expect(containerFor(a, "web").configHash).toBe(hashOf(a));
    expect(hashOf(a)).toBe(hashOf(b));
    expect(hashOf(a)).not.toBe(hashOf(c));
  });

  it("changes the config-hash when single-pod mode is toggled (topology-aware)", () => {
    const def = containerFor(translate(model([service("web")]), {}), "web").configHash;
    const pod = containerFor(translate(model([service("web")]), { podMode: true }), "web").configHash;
    expect(def).not.toBe(pod);
  });
});

describe("translate — single-pod mode", () => {
  it("creates a project pod, joins every container, and hoists ports to the pod", () => {
    const web = service("web", { ports: [{ target: 80, published: "8080", protocol: "tcp" }] });
    const plan = translate(model([web]), { podMode: true });
    expect(plan.pod?.name).toBe("proj");
    const body = containerFor(plan, "web").body;
    expect(body.pod).toBe("proj");
    expect(body.portmappings).toBeUndefined();
    expect(plan.pod?.body.portmappings).toEqual([{ container_port: 80, host_port: 8080, protocol: "tcp" }]);
  });

  it("warns when two services publish the same host port in one pod", () => {
    const a = service("a", { ports: [{ target: 80, published: "8080", protocol: "tcp" }] });
    const b = service("b", { ports: [{ target: 90, published: "8080", protocol: "tcp" }] });
    const plan = translate(model([a, b]), { podMode: true });
    expect(plan.warnings.some((w) => /8080/.test(w))).toBe(true);
  });

  it("detectPodPortConflicts flags each duplicated host port and nothing when unique", () => {
    const a = service("a", { ports: [{ target: 80, published: "8080", protocol: "tcp" }] });
    const b = service("b", { ports: [{ target: 81, published: "8080", protocol: "tcp" }] });
    const c = service("c", { ports: [{ target: 82, published: "9090", protocol: "tcp" }] });
    expect(detectPodPortConflicts(model([a, b]))).toHaveLength(1);
    expect(detectPodPortConflicts(model([a, c]))).toEqual([]);
    // Same port number, different protocol → not a conflict (distinct host bindings).
    const u = service("u", { ports: [{ target: 53, published: "53", protocol: "udp" }] });
    const t = service("t", { ports: [{ target: 53, published: "53", protocol: "tcp" }] });
    expect(detectPodPortConflicts(model([u, t]))).toEqual([]);
  });

  it("omits per-container hostname in single-pod mode (the pod owns the UTS namespace)", () => {
    const web = service("web", { hostname: "api" });
    expect(containerFor(translate(model([web]), {}), "web").body.hostname).toBe("api");
    expect(containerFor(translate(model([web]), { podMode: true }), "web").body.hostname).toBeUndefined();
  });
});

describe("translate — warnings", () => {
  it("surfaces unsupported keys as warnings", () => {
    const plan = translate(model([service("web")], { unsupported: [{ path: "services.web.build" }] }), {});
    expect(plan.warnings.some((w) => /services\.web\.build/.test(w))).toBe(true);
  });
});

describe("translate — healthcheck + health gates", () => {
  it("emits a libpod healthconfig (PascalCase, ns durations) from a service healthcheck", () => {
    const db = service("db", {
      healthcheck: {
        test: ["CMD-SHELL", "pg_isready"],
        intervalNs: 10_000_000_000,
        timeoutNs: 3_000_000_000,
        startPeriodNs: 1_000_000_000,
        retries: 5,
      },
    });
    const body = containerFor(translate(model([db]), {}), "db").body;
    expect(body.healthconfig).toEqual({
      Test: ["CMD-SHELL", "pg_isready"],
      Interval: 10_000_000_000,
      Timeout: 3_000_000_000,
      StartPeriod: 1_000_000_000,
      Retries: 5,
    });
  });

  it("omits healthconfig when the service has no healthcheck", () => {
    expect(containerFor(translate(model([service("web")]), {}), "web").body.healthconfig).toBeUndefined();
  });

  it("maps healthDeps to plan.healthGates keyed by container name (dep container names)", () => {
    const db = service("db");
    const api = service("api", { healthDeps: ["db"], dependsOn: ["db"] });
    const plan = translate(model([db, api]), {});
    expect(plan.healthGates).toEqual({ proj_api_1: ["proj_db_1"] });
  });

  it("honors container_name when mapping health gates", () => {
    const db = service("db", { containerName: "the-db" });
    const api = service("api", { healthDeps: ["db"], containerName: "the-api" });
    const plan = translate(model([db, api]), {});
    expect(plan.healthGates).toEqual({ "the-api": ["the-db"] });
  });

  it("leaves healthGates undefined when nothing is gated", () => {
    expect(translate(model([service("web")]), {}).healthGates).toBeUndefined();
  });
});
