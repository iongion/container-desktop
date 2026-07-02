import { describe, expect, it } from "vitest";
import { installFakeCommand } from "@/__tests__/setup/fakeCommand";
import { BuildAdapter } from "@/container-client/adapters/build";
import type { BuildRun, ImageBuildOptions } from "@/container-client/builder/types";
import { useBuildStore } from "@/web-app/stores/buildStore";
import { createBuildSink } from "./useBuildStreaming";

const opts = (over: Partial<ImageBuildOptions> = {}): ImageBuildOptions => ({
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

const run = (over: Partial<BuildRun> = {}): BuildRun => ({
  id: "r1",
  connectionId: "c",
  engine: "docker",
  options: opts(),
  argvPreview: "docker buildx build .",
  status: "running",
  startedAt: 0,
  steps: [],
  tags: [],
  ...over,
});

const fakeHost = () =>
  ({ ENGINE: "docker", isScoped: () => false, getSettings: async () => ({ program: { path: "docker" } }) }) as any;

describe("createBuildSink", () => {
  it("pipes a streamed build into the store and finishes it succeeded", async () => {
    useBuildStore.setState({ runs: {}, order: [], activeRunId: undefined });
    useBuildStore.getState().startRun(run({ id: "r1", status: "running" }));
    const handle = installFakeCommand();
    try {
      await new Promise<void>((resolve) => {
        const sink = createBuildSink("r1", () => resolve());
        void new BuildAdapter(fakeHost()).start(opts(), sink);
      });
      expect(useBuildStore.getState().runs.r1.status).toBe("succeeded");
    } finally {
      handle.restore();
    }
  });
});
