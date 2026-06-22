import { describe, expect, it } from "vitest";
import { dockerNormalizers } from "@/container-client/normalizers/docker";
import { podmanNormalizers } from "@/container-client/normalizers/podman";
import { type Container, ContainerEngine, type ContainerImage } from "@/env/Types";
import { groupContainers } from "@/web-app/screens/Container/grouping";

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
});
