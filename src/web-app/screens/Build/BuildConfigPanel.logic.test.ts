import { describe, expect, it } from "vitest";
import type { ImageBuildOptions } from "@/container-client/build/types";
import { buildArgvPreview, buildRedactedPreview, canLoadLocally } from "./BuildConfigPanel.logic";

const options = (over: Partial<ImageBuildOptions> = {}): ImageBuildOptions => ({
  engine: "docker",
  connectionId: "c",
  containerfilePath: "Containerfile",
  contextDir: ".",
  tags: [],
  buildArgs: {},
  labels: {},
  platforms: ["linux/amd64"],
  noCache: false,
  pull: false,
  secrets: [],
  sshMounts: [],
  namedContexts: [],
  cacheFrom: [],
  cacheTo: [],
  ...over,
});

describe("buildArgvPreview", () => {
  it("reflects Apple's reduced surface (no ssh/cache/build-context even if requested)", () => {
    const preview = buildArgvPreview(
      options({
        engine: "apple",
        sshMounts: [{ id: "default" }],
        cacheFrom: ["type=registry"],
        namedContexts: [{ name: "a", value: "b" }],
      }),
    );
    expect(preview.startsWith("container build --progress=plain")).toBe(true);
    expect(preview).not.toContain("--ssh");
    expect(preview).not.toContain("--cache-from");
    expect(preview).not.toContain("--build-context");
  });

  it("emits a csv --platform for Docker multi-platform", () => {
    const preview = buildArgvPreview(options({ platforms: ["linux/amd64", "linux/arm64"] }));
    expect(preview).toContain("--platform linux/amd64,linux/arm64");
  });
});

describe("buildRedactedPreview", () => {
  it("never shows a raw secret value", () => {
    const preview = buildRedactedPreview(options({ buildArgs: { API_TOKEN: "sk-ant-abc123def456ghi789" } }));
    expect(preview).not.toContain("sk-ant-abc123def456ghi789");
  });
});

describe("canLoadLocally", () => {
  it("is true for a single-platform, non-push build and false otherwise", () => {
    expect(canLoadLocally(options())).toBe(true);
    expect(canLoadLocally(options({ platforms: ["linux/amd64", "linux/arm64"] }))).toBe(false);
    expect(canLoadLocally(options({ push: true }))).toBe(false);
  });
});
