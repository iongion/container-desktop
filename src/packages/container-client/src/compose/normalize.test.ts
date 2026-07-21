import { describe, expect, it } from "vitest";

import { normalizeProject } from "./normalize";

const base = { name: "proj", projectDir: "/work/proj" };
const svc = (raw: object) => normalizeProject({ services: { web: raw } }, base).services[0];

describe("normalizeProject — project + services", () => {
  it("resolves the project name from the top-level name, else the provided default", () => {
    expect(normalizeProject({ name: "explicit", services: {} }, base).name).toBe("explicit");
    expect(normalizeProject({ services: {} }, base).name).toBe("proj");
  });

  it("builds a services array keyed by service name", () => {
    const model = normalizeProject({ services: { web: { image: "nginx" }, db: { image: "postgres" } } }, base);
    expect(model.services.map((s) => s.name)).toEqual(["web", "db"]);
    expect(model.services[0].image).toBe("nginx");
  });

  it("carries container_name, working_dir, user, hostname, privileged", () => {
    const s = svc({
      image: "x",
      container_name: "fixed",
      working_dir: "/app",
      user: "1000",
      hostname: "h",
      privileged: true,
    });
    expect(s.containerName).toBe("fixed");
    expect(s.workingDir).toBe("/app");
    expect(s.user).toBe("1000");
    expect(s.hostname).toBe("h");
    expect(s.privileged).toBe(true);
  });

  it("splits a string command/entrypoint into argv; keeps arrays as-is", () => {
    expect(svc({ image: "x", command: "npm run start" }).command).toEqual(["npm", "run", "start"]);
    expect(svc({ image: "x", entrypoint: ["/bin/sh", "-c", "echo hi"] }).entrypoint).toEqual([
      "/bin/sh",
      "-c",
      "echo hi",
    ]);
  });
});

describe("normalizeProject — ports", () => {
  it("parses short ports (published:target, ip, protocol)", () => {
    expect(svc({ image: "x", ports: ["8080:80"] }).ports[0]).toEqual({
      published: "8080",
      target: 80,
      protocol: "tcp",
    });
    expect(svc({ image: "x", ports: ["127.0.0.1:8080:80/udp"] }).ports[0]).toEqual({
      hostIp: "127.0.0.1",
      published: "8080",
      target: 80,
      protocol: "udp",
    });
    expect(svc({ image: "x", ports: ["80"] }).ports[0]).toEqual({ target: 80, protocol: "tcp" });
  });

  it("parses long ports", () => {
    const s = svc({ image: "x", ports: [{ target: 80, published: 8080, protocol: "udp", host_ip: "0.0.0.0" }] });
    expect(s.ports[0]).toEqual({ target: 80, published: "8080", protocol: "udp", hostIp: "0.0.0.0" });
  });
});

describe("normalizeProject — volumes/mounts", () => {
  it("distinguishes named-volume from bind mounts and reads :ro", () => {
    const s = svc({ image: "x", volumes: ["data:/var/lib", "./html:/usr/share:ro", "/abs:/mnt"] });
    expect(s.mounts).toEqual([
      { type: "volume", source: "data", target: "/var/lib" },
      { type: "bind", source: "./html", target: "/usr/share", readOnly: true },
      { type: "bind", source: "/abs", target: "/mnt" },
    ]);
  });
});

describe("normalizeProject — environment", () => {
  it("normalizes map and list environment to a string record", () => {
    expect(svc({ image: "x", environment: { A: "1", B: 2 } }).environment).toEqual({ A: "1", B: "2" });
    expect(svc({ image: "x", environment: ["A=1", "BARE"] }).environment).toEqual({ A: "1", BARE: "" });
  });

  it("merges env_file first, then inline environment wins", () => {
    const model = normalizeProject(
      { services: { web: { image: "x", env_file: "app.env", environment: { SHARED: "inline" } } } },
      { ...base, resolveEnvFile: () => ({ SHARED: "file", ONLY_FILE: "yes" }) },
    );
    expect(model.services[0].environment).toEqual({ SHARED: "inline", ONLY_FILE: "yes" });
  });
});

describe("normalizeProject — depends_on / networks / profiles", () => {
  it("normalizes depends_on list and map form to a name array", () => {
    expect(svc({ image: "x", depends_on: ["db", "cache"] }).dependsOn).toEqual(["db", "cache"]);
    expect(svc({ image: "x", depends_on: { db: { condition: "service_started" } } }).dependsOn).toEqual(["db"]);
  });

  it("attaches services with no networks key to 'default', and reads aliases", () => {
    expect(svc({ image: "x" }).networks).toEqual([{ name: "default", aliases: [] }]);
    const s = svc({ image: "x", networks: { backend: { aliases: ["api"] }, frontend: null } });
    expect(s.networks).toEqual([
      { name: "backend", aliases: ["api"] },
      { name: "frontend", aliases: [] },
    ]);
  });

  it("excludes services with an inactive profile, keeps them when the profile is active", () => {
    // No active profiles → a profiled service is not deployed; unprofiled services always are.
    const off = normalizeProject({ services: { web: { image: "x" }, dbg: { image: "y", profiles: ["debug"] } } }, base);
    expect(off.services.map((s) => s.name)).toEqual(["web"]);
    // Activating the profile includes it (and the profiles are recorded on the model).
    const on = normalizeProject(
      { services: { dbg: { image: "y", profiles: ["debug"] } } },
      { ...base, activeProfiles: ["debug"] },
    );
    expect(on.services.map((s) => s.name)).toEqual(["dbg"]);
    expect(on.services[0].profiles).toEqual(["debug"]);
  });
});

describe("normalizeProject — spec-faithful short syntax (review fixes)", () => {
  it("tokenizes quoted string command/entrypoint without splitting inside quotes", () => {
    expect(svc({ image: "x", command: 'sh -c "echo hi"' }).command).toEqual(["sh", "-c", "echo hi"]);
    expect(svc({ image: "x", entrypoint: "/bin/sh -c 'a b'" }).entrypoint).toEqual(["/bin/sh", "-c", "a b"]);
  });

  it("parses a bracketed IPv6 host ip and a port range", () => {
    expect(svc({ image: "x", ports: ["[::1]:8080:80"] }).ports[0]).toEqual({
      hostIp: "::1",
      published: "8080",
      target: 80,
      protocol: "tcp",
    });
    expect(svc({ image: "x", ports: ["8000-8005:80-85"] }).ports[0]).toEqual({
      published: "8000",
      target: 80,
      range: 6,
      protocol: "tcp",
    });
  });

  it("keeps the Windows drive letter attached to a bind source", () => {
    expect(svc({ image: "x", volumes: ["C:\\Users\\me:/data:ro"] }).mounts[0]).toEqual({
      type: "bind",
      source: "C:\\Users\\me",
      target: "/data",
      readOnly: true,
    });
  });

  it("flags top-level include and unimplemented depends_on conditions (not service_healthy) as unsupported", () => {
    const model = normalizeProject(
      {
        include: ["other.yaml"],
        services: { web: { image: "x", depends_on: { db: { condition: "service_completed_successfully" } } } },
      },
      base,
    );
    const paths = model.unsupported.map((u) => u.path);
    expect(paths).toContain("include");
    expect(paths.some((p) => p.includes("depends_on.db") && p.includes("service_completed_successfully"))).toBe(true);
  });
});

describe("normalizeProject — top-level networks/volumes + unsupported", () => {
  it("always includes an implicit default network plus declared ones", () => {
    const model = normalizeProject({ services: {}, networks: { backend: { driver: "bridge" } } }, base);
    expect(model.networks.map((n) => n.name).sort()).toEqual(["backend", "default"]);
  });

  it("captures top-level named volumes with external/driver", () => {
    const model = normalizeProject(
      { services: {}, volumes: { data: { driver: "local" }, ext: { external: true } } },
      base,
    );
    expect(model.volumes).toContainEqual({ name: "data", driver: "local" });
    expect(model.volumes).toContainEqual({ name: "ext", external: true });
  });

  it("reports unsupported service keys with their path", () => {
    const model = normalizeProject({ services: { web: { image: "x", build: "." } } }, base);
    expect(model.unsupported.map((u) => u.path)).toContain("services.web.build");
  });
});

describe("normalizeProject — depends_on health condition + healthcheck", () => {
  it("keeps every depends_on target for ordering and extracts service_healthy into healthDeps", () => {
    const web = svc({
      image: "nginx",
      depends_on: { db: { condition: "service_healthy" }, cache: { condition: "service_started" } },
    });
    expect(web.dependsOn.slice().sort()).toEqual(["cache", "db"]);
    expect(web.healthDeps).toEqual(["db"]);
  });

  it("array (short-form) depends_on yields no healthDeps", () => {
    const web = svc({ image: "nginx", depends_on: ["db", "cache"] });
    expect(web.dependsOn).toEqual(["db", "cache"]);
    expect(web.healthDeps).toEqual([]);
  });

  it("parses a string healthcheck into a CMD-SHELL test with nanosecond durations", () => {
    const db = svc({
      image: "postgres",
      healthcheck: { test: "pg_isready -U postgres", interval: "10s", timeout: "3s", retries: 5, start_period: "1s" },
    });
    expect(db.healthcheck).toEqual({
      test: ["CMD-SHELL", "pg_isready -U postgres"],
      intervalNs: 10_000_000_000,
      timeoutNs: 3_000_000_000,
      startPeriodNs: 1_000_000_000,
      retries: 5,
    });
  });

  it("keeps an array healthcheck test verbatim and disables via {disable:true}", () => {
    expect(
      svc({ image: "x", healthcheck: { test: ["CMD", "curl", "-f", "http://localhost"] } }).healthcheck?.test,
    ).toEqual(["CMD", "curl", "-f", "http://localhost"]);
    expect(svc({ image: "x", healthcheck: { disable: true } }).healthcheck).toEqual({ test: ["NONE"] });
  });

  it("parses compound durations (1m30s) to nanoseconds", () => {
    expect(svc({ image: "x", healthcheck: { test: "true", interval: "1m30s" } }).healthcheck?.intervalNs).toBe(
      90_000_000_000,
    );
  });

  it("no longer reports service_healthy as unsupported, but still flags service_completed_successfully", () => {
    const healthy = normalizeProject(
      { services: { web: { image: "n", depends_on: { db: { condition: "service_healthy" } } }, db: { image: "p" } } },
      base,
    );
    expect(healthy.unsupported.some((u) => /depends_on/.test(u.path))).toBe(false);
    const completed = normalizeProject(
      {
        services: {
          web: { image: "n", depends_on: { db: { condition: "service_completed_successfully" } } },
          db: { image: "p" },
        },
      },
      base,
    );
    expect(completed.unsupported.some((u) => /service_completed_successfully/.test(u.path))).toBe(true);
  });
});
