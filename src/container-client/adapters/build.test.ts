import { describe, expect, it } from "vitest";
import { installFakeCommand } from "@/__tests__/setup/fakeCommand";
import type { ImageBuildOptions } from "../build/types";
import { BuildAdapter } from "./build";

const opts = (over: Partial<ImageBuildOptions> = {}): ImageBuildOptions => ({
  engine: "docker",
  connectionId: "c",
  containerfilePath: "Containerfile",
  contextDir: "/ctx",
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

const fakeHost = (engine = "docker") =>
  ({ ENGINE: engine, getSettings: async () => ({ program: { path: engine } }) }) as any;

describe("BuildAdapter", () => {
  it("buildArgv selects the engine program and its flag mapper", () => {
    const { program, args, cwd } = new BuildAdapter(fakeHost()).buildArgv(opts());
    expect(program).toBe("docker");
    expect(args.slice(0, 3)).toEqual(["buildx", "build", "--progress=rawjson"]);
    expect(cwd).toBe("/ctx");
  });

  it("start streams the build to the sink and resolves onDone(0)", async () => {
    const handle = installFakeCommand();
    try {
      const done = await new Promise<number | null>((resolve) => {
        void new BuildAdapter(fakeHost()).start(opts(), {
          onStep: () => {},
          onLog: () => {},
          onError: () => {},
          onDone: (code) => resolve(code),
        });
      });
      expect(done).toBe(0);
      expect(handle.calls.some((call) => call.args.includes("build"))).toBe(true);
    } finally {
      handle.restore();
    }
  });
});
