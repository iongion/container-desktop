import { describe, expect, it } from "vitest";

import { dockerNormalizers } from "./docker";
import { podmanNormalizers } from "./podman";

// The normalizer guard: feed representative raw Podman + Docker payloads, assert the canonical model.
// Only `normalizeNetwork` differs between engines; every other transform is shared (verified below).

describe("normalizeContainer", () => {
  it("podman list item — State string, ImageName → Image, group split on '_' prefix", () => {
    const raw: any = {
      Id: "abc",
      ImageName: "docker.io/library/nginx:latest",
      Names: ["web_server"],
      State: "running",
    };
    const out = podmanNormalizers.normalizeContainer(raw);
    expect(out.Image).toBe("docker.io/library/nginx:latest");
    expect(out.Computed.DecodedState).toBe("running");
    expect(out.Computed.Name).toBe("web_server");
    expect(out.Computed.Group).toBe("web");
    expect(out.Computed.NameInGroup).toBe("server");
    expect(out.Ports).toEqual([]);
  });

  it("docker inspect item — State object → DecodedState from Status, strips Docker's leading slash", () => {
    const raw: any = {
      Id: "def",
      Names: ["/lonely"],
      State: { Status: "exited" },
    };
    const out = dockerNormalizers.normalizeContainer(raw);
    expect(out.Computed.DecodedState).toBe("exited");
    expect(out.Computed.Name).toBe("lonely");
    expect(out.Computed.Group).toBe("lonely");
    expect(out.Computed.NameInGroup).toBe("");
  });

  it("docker compose-style item — strips slash and groups on the first '-' or '_' separator", () => {
    const raw: any = {
      Id: "ghi",
      Names: ["/kalshi_target_words-minio-1"],
      State: "running",
    };
    const out = dockerNormalizers.normalizeContainer(raw);
    expect(out.Computed.Name).toBe("kalshi_target_words-minio-1");
    expect(out.Computed.Group).toBe("kalshi");
    expect(out.Computed.NameInGroup).toBe("target_words-minio-1");
  });

  it("infra container → 'Pod infrastructure' group (issue grouping)", () => {
    const raw: any = { Id: "p", Names: ["mypod-infra"], State: "running" };
    const out = podmanNormalizers.normalizeContainer(raw);
    expect(out.Computed.Group).toBe("Pod infrastructure");
    expect(out.Computed.NameInGroup).toBe("mypod");
  });
});

describe("normalizeImage", () => {
  it("podman — Names → Name/Tag/Registry/FullName", () => {
    const raw: any = { Id: "i1", Names: ["docker.io/library/nginx:latest"] };
    const out = podmanNormalizers.normalizeImage(raw);
    expect(out.Name).toBe("library/nginx");
    expect(out.Tag).toBe("latest");
    expect(out.Registry).toBe("docker.io");
    expect(out.FullName).toBe("library/nginx:latest");
    expect(out.History).toEqual([]);
  });

  it("docker — no Names, falls back to RepoTags; default registry docker.io", () => {
    const raw: any = { Id: "i2", RepoTags: ["nginx:latest"] };
    const out = dockerNormalizers.normalizeImage(raw);
    expect(out.Name).toBe("nginx");
    expect(out.Tag).toBe("latest");
    expect(out.Registry).toBe("docker.io");
    expect(out.FullName).toBe("nginx:latest");
  });
});

describe("normalizePod", () => {
  it("null Containers → [] and Processes initialized", () => {
    const raw: any = { Id: "pod1", Containers: null };
    const out = podmanNormalizers.normalizePod(raw);
    expect(out.Containers).toEqual([]);
    expect(out.Processes).toEqual({ Processes: [], Titles: [] });
  });
});

describe("normalizeNetwork (the engine delta)", () => {
  it("docker — PascalCase → canonical lowercase", () => {
    const raw: any = {
      Driver: "bridge",
      Id: "netid",
      Internal: false,
      IPAM: { config: [] },
      EnabledIPv6: true,
      Labels: { a: "b" },
      Name: "mynet",
      Created: "2024-01-01",
    };
    expect(dockerNormalizers.normalizeNetwork(raw)).toEqual({
      dns_enabled: false,
      driver: "bridge",
      id: "netid",
      internal: false,
      ipam_options: { config: [] },
      ipv6_enabled: true,
      labels: { a: "b" },
      name: "mynet",
      network_interface: "n/a",
      options: {},
      subnets: [],
      created: "2024-01-01",
    });
  });

  it("podman — libpod network is already canonical → passthrough (same reference)", () => {
    const raw: any = { driver: "podman", id: "x", name: "podman", internal: false };
    expect(podmanNormalizers.normalizeNetwork(raw)).toBe(raw);
  });
});

describe("normalizeVolume / normalizeSecret", () => {
  it("are identity across both engines (no per-item coercion in the source)", () => {
    const vol: any = { Name: "v", Driver: "local" };
    expect(podmanNormalizers.normalizeVolume(vol)).toBe(vol);
    expect(dockerNormalizers.normalizeVolume(vol)).toBe(vol);
    const secret: any = { ID: "s" };
    expect(podmanNormalizers.normalizeSecret(secret)).toBe(secret);
    expect(dockerNormalizers.normalizeSecret(secret)).toBe(secret);
  });
});

describe("normalizeRegistrySearchResult", () => {
  it("seeds Index from the searched registry, preserving an existing Index", () => {
    const opts: any = { registry: { name: "docker.io" } };
    expect(podmanNormalizers.normalizeRegistrySearchResult({ Name: "nginx" } as any, opts).Index).toBe("docker.io");
    expect(
      podmanNormalizers.normalizeRegistrySearchResult({ Name: "nginx", Index: "quay.io" } as any, opts).Index,
    ).toBe("quay.io");
  });
});

describe("engine symmetry", () => {
  it("shares every transform except normalizeNetwork", () => {
    expect(podmanNormalizers.normalizeContainer).toBe(dockerNormalizers.normalizeContainer);
    expect(podmanNormalizers.normalizeImage).toBe(dockerNormalizers.normalizeImage);
    expect(podmanNormalizers.normalizePod).toBe(dockerNormalizers.normalizePod);
    expect(podmanNormalizers.normalizeVolume).toBe(dockerNormalizers.normalizeVolume);
    expect(podmanNormalizers.normalizeSecret).toBe(dockerNormalizers.normalizeSecret);
    expect(podmanNormalizers.normalizeRegistrySearchResult).toBe(dockerNormalizers.normalizeRegistrySearchResult);
    expect(podmanNormalizers.normalizeNetwork).not.toBe(dockerNormalizers.normalizeNetwork);
  });
});
