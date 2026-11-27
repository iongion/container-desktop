import { describe, expect, it } from "vitest";
import { buildAppleArgs } from "@/container-client/builder/flags/apple";
import type { ImageBuildOptions } from "@/container-client/builder/types";

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

  it("omits unsupported cache/named-context flags but keeps labels and secrets", () => {
    const argv = buildAppleArgs(
      base({
        cacheFrom: ["x"],
        cacheTo: ["y"],
        namedContexts: [{ name: "a", value: "b" }],
        labels: { k: "v" },
        secrets: [{ id: "tok", src: "/t" }],
      }),
    );
    const s = argv.join(" ");
    expect(s).not.toContain("--cache-from");
    expect(s).not.toContain("--cache-to");
    expect(s).not.toContain("--build-context");
    expect(s).toContain("--label k=v");
    expect(s).toContain("--secret id=tok,src=/t");
  });

  // `container build --ssh` takes only `default`: the agent is forwarded once, any other mount is dropped.
  it("forwards the SSH agent with --ssh default, and drops any other mount", () => {
    const argv = buildAppleArgs(
      base({ sshMounts: [{ id: "default" }, { id: "git", source: "/k" }, { id: "default" }] }),
    );
    expect(argv.filter((arg) => arg === "--ssh")).toHaveLength(1);
    expect(argv.join(" ")).toContain("--ssh default");
    expect(argv.join(" ")).not.toContain("git");
  });

  it("asks for no SSH agent when no default mount is requested", () => {
    expect(buildAppleArgs(base({ sshMounts: [{ id: "git", source: "/k" }] }))).not.toContain("--ssh");
  });

  // `--platform` repeats: one image with every platform, amd64 through Rosetta.
  it("emits every requested platform", () => {
    const argv = buildAppleArgs(base({ platforms: ["linux/arm64", "linux/amd64"] }));
    expect(argv.join(" ")).toContain("--platform linux/arm64 --platform linux/amd64");
  });
});
