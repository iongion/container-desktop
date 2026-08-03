import { describe, expect, it } from "vitest";

import type { ContainerImage } from "@/container-client/types/image";

import { buildImageSummary } from "./inspectSummary";

const baseImage = (overrides: Partial<ContainerImage> = {}): ContainerImage =>
  ({
    Containers: 2,
    Created: 1_700_000_000, // epoch seconds
    CreatedAt: "",
    Digest: "sha256:abcdef0123456789",
    History: [],
    Id: "sha256:1234567890abcdef1111",
    Labels: null,
    Names: ["docker.io/library/nginx:1.27"],
    ParentId: "",
    SharedSize: 0,
    Size: 142_000_000,
    VirtualSize: 142_000_000,
    Name: "library/nginx",
    Tag: "1.27",
    Registry: "docker.io",
    FullName: "library/nginx:1.27",
    Config: {} as any,
    ...overrides,
  }) as ContainerImage;

const byKey = (rows: ReturnType<typeof buildImageSummary>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("buildImageSummary", () => {
  it("surfaces name, registry, tag, short id, size, usage and created", () => {
    const rows = byKey(buildImageSummary(baseImage()));
    expect(rows.name.value).toBe("library/nginx");
    expect(rows.registry.value).toBe("docker.io");
    expect(rows.tag.value).toBe("1.27");
    expect(rows.id.value).toBe("1234567890ab");
    expect(rows.id.copyText).toBe("sha256:1234567890abcdef1111");
    expect(rows.id.mono).toBe(true);
    expect(String(rows.size.value)).toContain("MB");
    expect(rows.containers.value).toBe("2");
    expect(String(rows.created.value)).toMatch(/\d{2} \w{3} \d{4}/);
  });

  it("shows digest and places it right after tag (identity-critical, paired with tag)", () => {
    const rows = buildImageSummary(baseImage());
    const keys = rows.map((r) => r.key);
    expect(keys.indexOf("digest")).toBe(keys.indexOf("tag") + 1);
    expect(keys.indexOf("digest")).toBeLessThan(keys.indexOf("id"));
  });

  it("derives the digest from RepoDigests on Docker (Digest empty)", () => {
    const rows = byKey(buildImageSummary(baseImage({ Digest: "", RepoDigests: ["nginx@sha256:deadbeefcafe0000"] })));
    expect(rows.digest.value).toBe("sha256:deadbeefcafe0000");
  });

  it("omits digest only when neither Digest nor RepoDigests exist", () => {
    expect(buildImageSummary(baseImage({ Digest: "", RepoDigests: undefined })).some((r) => r.key === "digest")).toBe(
      false,
    );
  });

  it("omits tag when the image is untagged", () => {
    expect(buildImageSummary(baseImage({ Tag: "" })).some((r) => r.key === "tag")).toBe(false);
  });

  it("keeps every row keyed and labelled", () => {
    for (const row of buildImageSummary(baseImage())) {
      expect(row.key).toBeTruthy();
      expect(row.label).toBeTruthy();
    }
  });
});
