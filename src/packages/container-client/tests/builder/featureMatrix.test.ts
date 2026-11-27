import { describe, expect, it } from "vitest";
import { FEATURE_MATRIX } from "@/container-client/builder/featureMatrix";

describe("FEATURE_MATRIX", () => {
  it("Apple Container supports labels, the SSH agent and multi-platform, but not cache/named-contexts", () => {
    expect(FEATURE_MATRIX.apple.label).toBe(true);
    expect(FEATURE_MATRIX.apple.ssh).toBe(true);
    expect(FEATURE_MATRIX.apple.multiPlatform).toBe(true);
    expect(FEATURE_MATRIX.apple.cache).toBe(false);
    expect(FEATURE_MATRIX.apple.namedContexts).toBe(false);
  });

  // Only buildx pushes from the build command; `podman build` and `container build` have no push flag.
  it("only Docker pushes as part of the build", () => {
    expect(FEATURE_MATRIX.docker.push).toBe(true);
    expect(FEATURE_MATRIX.podman.push).toBe(false);
    expect(FEATURE_MATRIX.apple.push).toBe(false);
  });

  it("Docker (buildx) supports ssh, cache and named contexts", () => {
    expect(FEATURE_MATRIX.docker.ssh && FEATURE_MATRIX.docker.cache && FEATURE_MATRIX.docker.namedContexts).toBe(true);
  });

  it("only Docker reports structured progress; Podman does not expose output/structuredProgress", () => {
    expect(FEATURE_MATRIX.docker.structuredProgress).toBe(true);
    expect(FEATURE_MATRIX.podman.structuredProgress).toBe(false);
    expect(FEATURE_MATRIX.podman.output).toBe(false);
  });
});
