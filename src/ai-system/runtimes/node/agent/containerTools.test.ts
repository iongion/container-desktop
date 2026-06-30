import { describe, expect, it, vi } from "vitest";

import { type AgentToolDeps, type CachedVerdict, type EngineOps, toolKey } from "@/ai-system/core";
import { createContainerTools, executeContainerTool, listContainersInput, runContainerTool } from "./containerTools";

const cache =
  (...entries: Array<[string, CachedVerdict]>) =>
  (key: string): CachedVerdict =>
    entries.find(([k]) => k === key)?.[1];

function mockEngineOps(over: Partial<EngineOps> = {}): EngineOps {
  return {
    listConnections: vi.fn(() => [{ id: "c1", name: "Podman", engine: "podman", running: true }]),
    listContainers: vi.fn(async () => [
      {
        Id: "abcdef1234567890",
        Image: "nginx",
        Names: ["web"],
        Computed: { Name: "web", DecodedState: "running" },
        State: "running",
        Status: "Up",
        Ports: {},
      } as any,
    ]),
    inspectContainer: vi.fn(async () => ({ Id: "abcdef1234567890", Image: "nginx" }) as any),
    getContainerLogs: vi.fn(async () => "starting\nAWS_SECRET_KEY=supersecretvalue\nready"),
    getContainerStats: vi.fn(async () => ({ name: "web", memory_stats: { usage: 100, limit: 1000 } }) as any),
    listImages: vi.fn(async () => [
      {
        Id: "img1234567890",
        FullName: "docker.io/library/nginx:latest",
        Name: "nginx",
        Tag: "latest",
        Size: 142000000,
      } as any,
    ]),
    inspectImage: vi.fn(async () => ({ Id: "img1234567890", FullName: "docker.io/library/nginx:latest" }) as any),
    listNetworks: vi.fn(async () => [{ id: "net123", name: "podman", driver: "bridge" } as any]),
    inspectNetwork: vi.fn(async () => ({ id: "net123", name: "podman", driver: "bridge" }) as any),
    listVolumes: vi.fn(async () => [
      { Name: "data", Driver: "local", Mountpoint: "/var/lib/containers/storage/volumes/data/_data" } as any,
    ]),
    inspectVolume: vi.fn(async () => ({ Name: "data", Driver: "local" }) as any),
    startContainer: vi.fn(async () => true),
    stopContainer: vi.fn(async () => true),
    restartContainer: vi.fn(async () => true),
    pauseContainer: vi.fn(async () => true),
    unpauseContainer: vi.fn(async () => true),
    removeContainer: vi.fn(async () => true),
    pullImage: vi.fn(async () => true),
    removeImage: vi.fn(async () => true),
    removeNetwork: vi.fn(async () => true),
    removeVolume: vi.fn(async () => true),
    ...over,
  } as EngineOps;
}

function deps(over: Partial<AgentToolDeps> = {}): AgentToolDeps {
  return {
    runSandboxed: vi.fn() as any,
    searchKnowledge: vi.fn(async () => []),
    mode: "ask",
    engineOps: mockEngineOps(),
    ...over,
  };
}

describe("executeContainerTool — dispatch + summary + redaction", () => {
  it("listContainers: full typed result for the card + a compact summary for the model", async () => {
    const ops = mockEngineOps();
    const out = await executeContainerTool(ops, "listContainers", {});
    expect(ops.listContainers).toHaveBeenCalledWith({ connectionId: undefined });
    expect(out.ok).toBe(true);
    expect((out.result as unknown[]).length).toBe(1);
    expect(out.summary).toEqual([{ Id: "abcdef123456", Name: "web", Image: "nginx", State: "running" }]);
    expect(out.title).toBe("List containers");
  });

  it("threads connectionId through to the engine", async () => {
    const ops = mockEngineOps();
    await executeContainerTool(ops, "listContainers", { connectionId: "c2" });
    expect(ops.listContainers).toHaveBeenCalledWith({ connectionId: "c2" });
  });

  it("redacts secrets in container logs before they reach the model OR the card", async () => {
    const out = await executeContainerTool(mockEngineOps(), "getContainerLogs", { id: "abc" });
    const blob = `${JSON.stringify(out.result)}${JSON.stringify(out.summary)}`;
    expect(blob).not.toContain("supersecretvalue");
    expect(blob).toContain("[REDACTED]");
  });

  it("throws on an unknown tool name", async () => {
    await expect(executeContainerTool(mockEngineOps(), "frobnicate", {})).rejects.toThrow(/unknown/i);
  });
});

describe("runContainerTool — emits tool-call then tool-result (read tools, ungated)", () => {
  it("emits a tool-call badge then a tool-result carrying the full result, returns the model summary", async () => {
    const events: any[] = [];
    const out = await runContainerTool(deps({ onEvent: (e) => events.push(e) }), "listContainers", {});
    expect(events.map((e) => e.type)).toEqual(["tool-call", "tool-result"]);
    expect(events[0]).toMatchObject({ tool: "listContainers", title: "List containers" });
    expect(events[1]).toMatchObject({ tool: "listContainers", ok: true });
    expect(Array.isArray(out)).toBe(true);
  });

  it("on engine error emits a failed tool-result and returns a redacted error summary", async () => {
    const events: any[] = [];
    const ops = mockEngineOps({
      listContainers: vi.fn(async () => {
        throw new Error("boom AWS_SECRET_KEY=xyz");
      }),
    });
    const out: any = await runContainerTool(
      deps({ engineOps: ops, onEvent: (e) => events.push(e) }),
      "listContainers",
      {},
    );
    expect(events[1]).toMatchObject({ type: "tool-result", ok: false });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain("xyz");
  });
});

describe("executeContainerTool — mutations return an action result", () => {
  it("stopContainer returns { ok, op, id }", async () => {
    const ops = mockEngineOps();
    const out = await executeContainerTool(ops, "stopContainer", { id: "abc123" });
    expect(ops.stopContainer).toHaveBeenCalledWith(expect.objectContaining({ id: "abc123" }));
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({ ok: true, op: "stop", id: "abc123" });
  });

  it("pullImage keys on the reference", async () => {
    const ops = mockEngineOps();
    const out = await executeContainerTool(ops, "pullImage", { reference: "nginx:latest" });
    expect(ops.pullImage).toHaveBeenCalledWith(expect.objectContaining({ reference: "nginx:latest" }));
    expect(out.result).toMatchObject({ op: "pull", id: "nginx:latest" });
  });
});

describe("runContainerTool — mutating tools are permission-gated, reads are not", () => {
  it("read tools never gate, even in ask mode", async () => {
    const ops = mockEngineOps();
    await runContainerTool(deps({ engineOps: ops, mode: "ask" }), "listContainers", {});
    expect(ops.listContainers).toHaveBeenCalled();
  });

  it("ask mode: a mutation surfaces an approval-request and does NOT execute", async () => {
    const events: any[] = [];
    const ops = mockEngineOps();
    const out: any = await runContainerTool(
      deps({ engineOps: ops, mode: "ask", onEvent: (e) => events.push(e) }),
      "stopContainer",
      { id: "abc" },
    );
    expect(ops.stopContainer).not.toHaveBeenCalled();
    expect(out.awaitingApproval).toBe(true);
    expect(events.find((e) => e.type === "approval-request")).toMatchObject({
      kind: "tool",
      tool: "stopContainer",
      toolArgs: { id: "abc" },
      title: "Stop container abc",
    });
  });

  it("allow mode: a mutation runs and emits tool-call + tool-result", async () => {
    const events: any[] = [];
    const ops = mockEngineOps();
    await runContainerTool(deps({ engineOps: ops, mode: "allow", onEvent: (e) => events.push(e) }), "stopContainer", {
      id: "abc",
    });
    expect(ops.stopContainer).toHaveBeenCalledWith(expect.objectContaining({ id: "abc" }));
    expect(events.map((e) => e.type)).toEqual(["tool-call", "tool-result"]);
    expect(events[1]).toMatchObject({ ok: true });
  });

  it("remember mode: runs a cached-allow mutation, rejects a cached-block one without executing", async () => {
    const ops = mockEngineOps();
    await runContainerTool(
      deps({
        engineOps: ops,
        mode: "remember",
        cacheLookup: cache([toolKey("removeContainer", { id: "x" }), "allow"]),
      }),
      "removeContainer",
      { id: "x" },
    );
    expect(ops.removeContainer).toHaveBeenCalledWith(expect.objectContaining({ id: "x" }));

    const ops2 = mockEngineOps();
    const out2: any = await runContainerTool(
      deps({
        engineOps: ops2,
        mode: "remember",
        cacheLookup: cache([toolKey("removeContainer", { id: "y" }), "block"]),
      }),
      "removeContainer",
      { id: "y" },
    );
    expect(ops2.removeContainer).not.toHaveBeenCalled();
    expect(out2.rejected).toBe(true);
  });
});

describe("createContainerTools — wiring", () => {
  it("exposes the typed read tools when engineOps is present", () => {
    const tools = createContainerTools(deps());
    for (const name of [
      "listConnections",
      "listContainers",
      "inspectContainer",
      "getContainerLogs",
      "getContainerStats",
      "listImages",
      "inspectImage",
      "listNetworks",
      "inspectNetwork",
      "listVolumes",
      "inspectVolume",
    ]) {
      expect(tools[name]).toBeDefined();
    }
  });

  it("is empty without engineOps", () => {
    expect(createContainerTools(deps({ engineOps: undefined }))).toEqual({});
  });

  it("listContainers input is strict (connectionId optional, no extras)", () => {
    expect(listContainersInput.safeParse({}).success).toBe(true);
    expect(listContainersInput.safeParse({ connectionId: "c1" }).success).toBe(true);
    expect(listContainersInput.safeParse({ bogus: 1 }).success).toBe(false);
  });
});
