import { describe, expect, it } from "vitest";

import { ContainerEngine, ContainerStateList, PodStatusList } from "@/env/Types";

import { buildEngineDataset } from "../index";

const list = (value: unknown): any[] => value as any[];

describe("generator determinism", () => {
  it("produces a byte-identical dataset for the same seed (every engine)", () => {
    for (const engine of [ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE]) {
      expect(buildEngineDataset(engine)).toEqual(buildEngineDataset(engine));
    }
  });

  it("produces a different dataset for a different seed", () => {
    const def = list(buildEngineDataset(ContainerEngine.PODMAN).containers).map((c) => c.Id);
    const alt = list(buildEngineDataset(ContainerEngine.PODMAN, 99991).containers).map((c) => c.Id);
    expect(alt).not.toEqual(def);
  });

  it("resolves timestamps against the fixed ref date, not the wall clock (guards setDefaultRefDate)", () => {
    const ref = new Date("2024-11-02T12:00:00.000Z").getTime();
    const windowMs = 130 * 24 * 3600 * 1000; // widest faker.date.recent window used (images: 90d) + margin
    for (const container of list(buildEngineDataset(ContainerEngine.PODMAN).containers)) {
      const created = new Date(container.Created).getTime();
      expect(created).toBeLessThanOrEqual(ref);
      expect(created).toBeGreaterThan(ref - windowMs);
    }
  });
});

describe("generator counts (per-engine stress targets)", () => {
  it("podman meets every target", () => {
    const ds = buildEngineDataset(ContainerEngine.PODMAN);
    expect(list(ds.containers).length).toBeGreaterThanOrEqual(60);
    expect(list(ds.images).length).toBeGreaterThanOrEqual(30);
    expect(list(ds.networks).length).toBeGreaterThanOrEqual(30);
    expect(list(ds.volumes).length).toBeGreaterThanOrEqual(30);
    expect(list(ds.pods).length).toBeGreaterThanOrEqual(30);
    expect(list(ds.secrets).length).toBeGreaterThanOrEqual(30);
    expect(list(ds.machines).length).toBeGreaterThanOrEqual(30);
    expect(ds.registries.custom.length).toBeGreaterThanOrEqual(12);
  });

  it("docker meets targets; pods/secrets/machines are Podman-only (empty)", () => {
    const ds = buildEngineDataset(ContainerEngine.DOCKER);
    expect(list(ds.containers).length).toBeGreaterThanOrEqual(60);
    expect(list(ds.images).length).toBeGreaterThanOrEqual(30);
    expect(list(ds.networks).length).toBeGreaterThanOrEqual(30);
    expect((ds.volumes as { Volumes: unknown[] }).Volumes.length).toBeGreaterThanOrEqual(30);
    expect(ds.registries.custom.length).toBeGreaterThanOrEqual(12);
    expect(list(ds.pods).length).toBe(0);
    expect(list(ds.secrets).length).toBe(0);
    expect(list(ds.machines).length).toBe(0);
  });

  it("apple mirrors docker (no pods or machines)", () => {
    const ds = buildEngineDataset(ContainerEngine.APPLE);
    expect(list(ds.containers).length).toBeGreaterThanOrEqual(60);
    expect(list(ds.pods).length).toBe(0);
    expect(list(ds.machines).length).toBe(0);
  });
});

describe("generator cross-reference integrity (podman)", () => {
  const ds = buildEngineDataset(ContainerEngine.PODMAN);

  it("every container's image and network exist in the images/networks lists", () => {
    const imageRefs = new Set(list(ds.images).map((image) => image.RepoTags[0]));
    const networkNames = new Set(list(ds.networks).map((network) => network.name));
    for (const container of list(ds.containers)) {
      expect(imageRefs.has(container.Image)).toBe(true);
      expect(networkNames.has(container.Networks[0])).toBe(true);
    }
  });

  it("image Containers counts are truthful (== referencing containers)", () => {
    const usage = new Map<string, number>();
    for (const container of list(ds.containers)) {
      usage.set(container.ImageID, (usage.get(container.ImageID) ?? 0) + 1);
    }
    for (const image of list(ds.images)) {
      expect(image.Containers).toBe(usage.get(image.Id) ?? 0);
    }
  });

  it("there is an inspect record for every container and image id", () => {
    for (const container of list(ds.containers)) {
      expect(ds.containerInspect[container.Id]).toBeDefined();
    }
    for (const image of list(ds.images)) {
      expect(ds.imageInspect[image.Id]).toBeDefined();
    }
  });

  it("every pod has exactly one infra member and a consistent container count", () => {
    for (const pod of list(ds.pods)) {
      const infra = pod.Containers.filter((member: any) => `${member.Names}`.endsWith("-infra"));
      expect(infra.length).toBe(1);
      expect(pod.NumContainers).toBe(pod.Containers.length);
    }
  });
});

describe("generator per-engine raw shapes", () => {
  const podman = buildEngineDataset(ContainerEngine.PODMAN);
  const docker = buildEngineDataset(ContainerEngine.DOCKER);

  it("volumes: podman is a bare array, docker is the { Volumes } envelope", () => {
    expect(Array.isArray(podman.volumes)).toBe(true);
    expect(Array.isArray(docker.volumes)).toBe(false);
    expect(Array.isArray((docker.volumes as { Volumes: unknown[] }).Volumes)).toBe(true);
  });

  it("networks: podman is canonical lowercase, docker is PascalCase with IPAM/EnabledIPv6", () => {
    const pn = list(podman.networks)[0];
    expect(pn.name && pn.driver && pn.id).toBeTruthy();
    const dn = list(docker.networks)[0];
    expect(dn.Name && dn.Driver && dn.Id).toBeTruthy();
    expect(dn.IPAM).toBeDefined();
    expect(dn.EnabledIPv6).toBe(false);
  });

  it("containers: podman Command[] + Pod fields; docker Command string + no Pod", () => {
    const pc = list(podman.containers)[0];
    const dc = list(docker.containers)[0];
    expect(Array.isArray(pc.Command)).toBe(true);
    expect(pc.Pod).toBe("");
    expect(typeof dc.Command).toBe("string");
    expect(dc.Pod).toBeUndefined();
  });

  it("ports: podman uses container_port/host_port, docker uses PrivatePort/PublicPort", () => {
    const pc = list(podman.containers).find((c) => c.Ports.length);
    const dc = list(docker.containers).find((c) => c.Ports.length);
    if (pc) expect(pc.Ports[0]).toHaveProperty("container_port");
    if (dc) expect(dc.Ports[0]).toHaveProperty("PrivatePort");
  });

  it("images: docker carries RepoTags and no Names; podman carries Names", () => {
    expect(list(docker.images)[0].Names).toBeUndefined();
    expect(list(docker.images)[0].RepoTags.length).toBeGreaterThan(0);
    expect(list(podman.images)[0].Names.length).toBeGreaterThan(0);
  });

  it("every container State is a valid enum value and its Status text matches", () => {
    const states = new Set<string>(Object.values(ContainerStateList));
    for (const container of list(podman.containers)) {
      expect(states.has(container.State)).toBe(true);
      if (container.State === "running") expect(container.Status).toMatch(/^Up /);
      if (container.State === "exited") expect(container.Status).toMatch(/^Exited \(\d+\) /);
      if (container.State === "paused") expect(container.Status).toBe("Paused");
      if (container.State === "created") expect(container.Status).toBe("Created");
    }
  });

  it("every pod Status is a valid enum value", () => {
    const statuses = new Set<string>(Object.values(PodStatusList));
    for (const pod of list(podman.pods)) {
      expect(statuses.has(pod.Status)).toBe(true);
    }
  });
});
