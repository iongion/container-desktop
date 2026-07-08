import { describe, expect, it } from "vitest";
import { dockerNormalizers } from "@/container-client/normalizers/docker";
import { podmanNormalizers } from "@/container-client/normalizers/podman";
import { type Container, ContainerEngine, type ContainerImage } from "@/env/Types";
import { groupContainers } from "@/web-app/screens/Container/grouping";
import { buildMountGroups } from "@/web-app/screens/Volume/mounts/mountRows";
import { buildEngineDataset } from "../index";

const list = (value: unknown): any[] => value as any[];

describe("generated raw data survives the real normalizers", () => {
  it("podman containers normalize and every one gets a Computed.Group, forming multi-item groups", () => {
    const ds = buildEngineDataset(ContainerEngine.PODMAN);
    const normalized = list(ds.containers).map((raw) => podmanNormalizers.normalizeContainer(raw as Container));
    for (const container of normalized) {
      expect(container.Computed.Group).toBeTruthy();
    }
    const groups = groupContainers(normalized, "", undefined);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.some((group) => group.Items.length > 1)).toBe(true);
  });

  it("the first-listed container (the one the docs Inspect screenshot captures) is a running service with env, ports and mounts", () => {
    // resolveFirstId([data-container]) in the screenshot harness picks the very first rendered row, which is
    // groups[0].Items[0] under the default sort. That container must be a realistic, fully-populated service —
    // not a bare CI worker with empty Environment/Mounts/Ports — so 003-ContainerInspect.png shows real data.
    const ds = buildEngineDataset(ContainerEngine.PODMAN);
    const normalized = list(ds.containers).map((raw) => podmanNormalizers.normalizeContainer(raw as Container));
    const firstShown = groupContainers(normalized, "", undefined)[0].Items[0];
    expect(firstShown.Computed.DecodedState).toBe("running");
    const inspect = ds.containerInspect[firstShown.Id] as {
      Config: { Env: string[] };
      Ports: unknown[];
      Mounts: unknown[];
    };
    expect(inspect.Config.Env.length).toBeGreaterThan(0);
    expect(inspect.Ports.length).toBeGreaterThan(0);
    expect(inspect.Mounts.length).toBeGreaterThan(0);
  });

  it("podman images normalize to non-empty Name/Tag/Registry/FullName", () => {
    const ds = buildEngineDataset(ContainerEngine.PODMAN);
    for (const raw of list(ds.images)) {
      const image = podmanNormalizers.normalizeImage(raw as ContainerImage);
      expect(image.Name).toBeTruthy();
      expect(image.Tag).toBeTruthy();
      expect(image.Registry).toBeTruthy();
      expect(image.FullName).toBeTruthy();
    }
  });

  it("docker images normalize via the RepoTags fallback path", () => {
    const ds = buildEngineDataset(ContainerEngine.DOCKER);
    for (const raw of list(ds.images)) {
      const image = dockerNormalizers.normalizeImage(raw as ContainerImage);
      expect(image.Name).toBeTruthy();
      expect(image.Tag).toBeTruthy();
    }
  });

  it("docker networks normalize from PascalCase to canonical fields", () => {
    const ds = buildEngineDataset(ContainerEngine.DOCKER);
    for (const raw of list(ds.networks)) {
      const network = dockerNormalizers.normalizeNetwork(raw);
      expect(network.name).toBeTruthy();
      expect(network.driver).toBeTruthy();
      expect(network.id).toBeTruthy();
    }
  });

  it("docker generated volume mounts match listed volumes so the Mounts inspector can show sizes", () => {
    const ds = buildEngineDataset(ContainerEngine.DOCKER);
    const containers = list(ds.containers).map((raw) => ({
      ...dockerNormalizers.normalizeContainer(raw as Container),
      connectionId: "mock.docker.system",
      connectionName: "System Docker",
      engine: "docker",
    }));
    const volumes = list((ds.volumes as { Volumes: unknown[] }).Volumes).map((raw) => ({
      ...dockerNormalizers.normalizeVolume(raw as any),
      connectionId: "mock.docker.system",
      connectionName: "System Docker",
      engine: "docker",
    }));

    const groups = buildMountGroups(containers, volumes, "");
    const mountRows = groups.flatMap((group) => group.items).filter((item) => item.kind === "mount");
    const volumeRows = mountRows.filter((item) => item.kind === "mount" && item.mount.type === "volume");
    const sizedRows = volumeRows.filter((item) => item.kind === "mount" && typeof item.mount.size === "number");

    expect(volumeRows.length).toBeGreaterThan(0);
    expect(sizedRows.length).toBe(volumeRows.length);
  });
});
