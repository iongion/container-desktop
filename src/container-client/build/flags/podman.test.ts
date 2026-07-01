import { describe, expect, it } from "vitest";
import type { ImageBuildOptions } from "../types";
import { buildPodmanArgs } from "./podman";

const base = (over: Partial<ImageBuildOptions> = {}): ImageBuildOptions => ({
  engine: "podman",
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

describe("buildPodmanArgs", () => {
  it("starts with build, has no --load and no --progress, includes --layers, context last", () => {
    const argv = buildPodmanArgs(base({ contextDir: "/ctx" }));
    expect(argv[0]).toBe("build");
    expect(argv).not.toContain("--load");
    expect(argv.join(" ")).not.toContain("--progress");
    expect(argv).toContain("--layers");
    expect(argv[argv.length - 1]).toBe("/ctx");
  });

  it("maps tags, build-args and no-cache", () => {
    const argv = buildPodmanArgs(base({ tags: ["app:1"], buildArgs: { VER: "9" }, noCache: true }));
    const s = argv.join(" ");
    expect(s).toContain("-t app:1");
    expect(s).toContain("--build-arg VER=9");
    expect(argv).toContain("--no-cache");
  });
});
