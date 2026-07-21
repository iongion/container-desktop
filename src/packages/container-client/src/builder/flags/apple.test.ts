import { describe, expect, it } from "vitest";
import type { ImageBuildOptions } from "../types";
import { buildAppleArgs } from "./apple";

const base = (over: Partial<ImageBuildOptions> = {}): ImageBuildOptions => ({
  engine: "apple",
  connectionId: "c",
  containerfilePath: "Containerfile",
  contextDir: ".",
  tags: [],
  buildArgs: {},
  labels: {},
  platforms: [],
  noCache: false,
  pull: false,
  secrets: [],
  sshMounts: [],
  namedContexts: [],
  cacheFrom: [],
  cacheTo: [],
  ...over,
});

describe("buildAppleArgs", () => {
  it("starts with build --progress=plain and ends with the context dir", () => {
    const argv = buildAppleArgs(base({ contextDir: "/ctx" }));
    expect(argv.slice(0, 2)).toEqual(["build", "--progress=plain"]);
    expect(argv[argv.length - 1]).toBe("/ctx");
  });

  it("omits unsupported ssh/cache/named-context flags but keeps labels and secrets", () => {
    const argv = buildAppleArgs(
      base({
        sshMounts: [{ id: "default" }],
        cacheFrom: ["x"],
        cacheTo: ["y"],
        namedContexts: [{ name: "a", value: "b" }],
        labels: { k: "v" },
        secrets: [{ id: "tok", src: "/t" }],
      }),
    );
    const s = argv.join(" ");
    expect(s).not.toContain("--ssh");
    expect(s).not.toContain("--cache-from");
    expect(s).not.toContain("--cache-to");
    expect(s).not.toContain("--build-context");
    expect(s).toContain("--label k=v");
    expect(s).toContain("--secret id=tok,src=/t");
  });
});
