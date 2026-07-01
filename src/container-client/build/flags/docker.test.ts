import { describe, expect, it } from "vitest";
import type { ImageBuildOptions } from "../types";
import { buildDockerArgs } from "./docker";

const base = (over: Partial<ImageBuildOptions> = {}): ImageBuildOptions => ({
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

describe("buildDockerArgs", () => {
  it("starts with buildx build --progress=rawjson and ends with the context dir", () => {
    const argv = buildDockerArgs(base({ contextDir: "/ctx" }));
    expect(argv.slice(0, 3)).toEqual(["buildx", "build", "--progress=rawjson"]);
    expect(argv[argv.length - 1]).toBe("/ctx");
  });

  it("adds --load for a single-platform build with no push/output", () => {
    expect(buildDockerArgs(base())).toContain("--load");
  });

  it("multi-platform + push ⇒ no --load, has --push and a csv --platform", () => {
    const argv = buildDockerArgs(base({ platforms: ["linux/amd64", "linux/arm64"], push: true }));
    expect(argv).not.toContain("--load");
    expect(argv).toContain("--push");
    expect(argv.join(" ")).toContain("--platform linux/amd64,linux/arm64");
  });

  it("maps build-args and file secrets", () => {
    const argv = buildDockerArgs(base({ buildArgs: { VER: "9" }, secrets: [{ id: "tok", src: "/t" }] }));
    const s = argv.join(" ");
    expect(s).toContain("--build-arg VER=9");
    expect(s).toContain("--secret id=tok,src=/t");
  });
});
