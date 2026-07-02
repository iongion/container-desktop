import { beforeEach, describe, expect, it } from "vitest";
import type { BuildRun, BuildStep, ImageBuildOptions } from "@/container-client/builder/types";
import { toPersistedRun, useBuildStore } from "./buildStore";

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

const run = (over: Partial<BuildRun> = {}): BuildRun => ({
  id: "r1",
  connectionId: "c",
  engine: "docker",
  options: options(),
  argvPreview: "docker buildx build .",
  status: "running",
  startedAt: 0,
  steps: [],
  tags: [],
  ...over,
});

const step = (over: Partial<BuildStep> = {}): BuildStep => ({
  key: "s1",
  index: 1,
  name: "RUN x",
  status: "done",
  cached: false,
  logs: [],
  ...over,
});

describe("toPersistedRun", () => {
  it("never persists secret material, drops step logs and caps rawLogTail", () => {
    const persisted = toPersistedRun(
      run({
        options: options({
          buildArgs: { API_TOKEN: "sk-ant-abc123def456ghi789" },
          secrets: [{ id: "t", src: "/s" }],
        }),
        argvPreview: "docker buildx build --build-arg API_TOKEN=sk-ant-abc123def456ghi789 .",
        steps: [step({ logs: Array.from({ length: 9999 }, () => ({ ts: 0, stream: "stdout", text: "x" })) })],
        rawLogTail: "y".repeat(100_000),
      }),
    );
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("sk-ant-abc123def456ghi789");
    expect(persisted.steps[0].logs).toEqual([]);
    expect((persisted.rawLogTail ?? "").length).toBeLessThanOrEqual(32 * 1024);
  });
});

describe("useBuildStore", () => {
  beforeEach(() => {
    useBuildStore.setState({ runs: {}, order: [], activeRunId: undefined });
  });

  it("startRun → upsertStep → finishRun moves running to succeeded", () => {
    const store = useBuildStore.getState();
    store.startRun(run({ id: "r1", status: "running" }));
    store.upsertStep("r1", step({ key: "s1", name: "FROM", status: "cached", cached: true }));
    store.upsertStep("r1", step({ key: "s1", name: "FROM", status: "cached", cached: true }));
    store.finishRun("r1", 0);
    const persisted = useBuildStore.getState().runs.r1;
    expect(persisted.status).toBe("succeeded");
    expect(persisted.steps.length).toBe(1);
    expect(useBuildStore.getState().order[0]).toBe("r1");
  });

  it("finishRun with a non-zero code marks the run failed", () => {
    const store = useBuildStore.getState();
    store.startRun(run({ id: "r2", status: "running" }));
    store.finishRun("r2", 1);
    expect(useBuildStore.getState().runs.r2.status).toBe("failed");
  });
});
