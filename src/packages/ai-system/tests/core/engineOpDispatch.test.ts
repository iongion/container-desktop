import { describe, expect, it, vi } from "vitest";

import { dispatchEngineOp, isEngineOpName, parseEngineOpRequest } from "@/ai-system/core/engineOpDispatch";
import type { EngineOps } from "@/ai-system/core/types";

function fakeOps(overrides: Partial<Record<keyof EngineOps, unknown>> = {}): EngineOps {
  const base = {
    listConnections: vi.fn(() => [{ id: "primary", name: "Podman", engine: "podman", running: true }]),
    listContainers: vi.fn(async () => [{ Id: "c1" }]),
    inspectContainer: vi.fn(async () => ({ Id: "c1" })),
    getContainerLogs: vi.fn(async () => "line"),
    getContainerStats: vi.fn(async () => ({ name: "c1" })),
    startContainer: vi.fn(async () => true),
    stopContainer: vi.fn(async () => true),
    restartContainer: vi.fn(async () => true),
    pauseContainer: vi.fn(async () => true),
    unpauseContainer: vi.fn(async () => true),
    removeContainer: vi.fn(async () => true),
    listImages: vi.fn(async () => []),
    inspectImage: vi.fn(async () => undefined),
    pullImage: vi.fn(async () => true),
    removeImage: vi.fn(async () => true),
    listNetworks: vi.fn(async () => []),
    inspectNetwork: vi.fn(async () => ({ id: "n1", name: "bridge" })),
    removeNetwork: vi.fn(async () => true),
    listVolumes: vi.fn(async () => []),
    inspectVolume: vi.fn(async () => ({ Name: "v1" })),
    removeVolume: vi.fn(async () => true),
  };
  return { ...base, ...overrides } as unknown as EngineOps;
}

describe("isEngineOpName", () => {
  it("accepts every container tool name", () => {
    for (const op of ["listConnections", "listContainers", "startContainer", "pullImage", "removeVolume"]) {
      expect(isEngineOpName(op)).toBe(true);
    }
  });

  it("rejects anything else, including a pi built-in", () => {
    for (const op of ["bash", "read", "", "constructor", "toString", "deployToProd"]) {
      expect(isEngineOpName(op)).toBe(false);
    }
  });
});

describe("parseEngineOpRequest", () => {
  it("reads the op and its arguments out of a host request payload", () => {
    expect(parseEngineOpRequest({ op: "inspectContainer", args: { id: "c1" } })).toEqual({
      op: "inspectContainer",
      args: { id: "c1" },
    });
  });

  it("defaults absent arguments to an empty object", () => {
    expect(parseEngineOpRequest({ op: "listContainers" })).toEqual({ op: "listContainers", args: {} });
  });

  it("refuses a payload with no usable op", () => {
    expect(parseEngineOpRequest({})).toBeUndefined();
    expect(parseEngineOpRequest({ op: 42 })).toBeUndefined();
    expect(parseEngineOpRequest({ op: "bash", args: { command: "rm -rf /" } })).toBeUndefined();
  });
});

describe("dispatchEngineOp", () => {
  it("invokes the named operation and returns its value", async () => {
    const ops = fakeOps();
    const result = await dispatchEngineOp(ops, { op: "inspectContainer", args: { id: "c1" } });
    expect(result).toEqual({ ok: true, value: { Id: "c1" } });
    expect(ops.inspectContainer).toHaveBeenCalledWith({ id: "c1" });
  });

  it("defaults the connection to the session's, so a model that omits it acts where the session runs", async () => {
    const ops = fakeOps();
    await dispatchEngineOp(ops, { op: "listContainers", args: {} }, { connectionId: "session-conn" });
    expect(ops.listContainers).toHaveBeenCalledWith({ connectionId: "session-conn" });
  });

  it("lets an explicit connection win over the session's", async () => {
    const ops = fakeOps();
    await dispatchEngineOp(ops, { op: "listContainers", args: { connectionId: "other" } }, { connectionId: "mine" });
    expect(ops.listContainers).toHaveBeenCalledWith({ connectionId: "other" });
  });

  it("never scopes listConnections, whose point is discovering the other connections", async () => {
    const ops = fakeOps();
    const result = await dispatchEngineOp(ops, { op: "listConnections", args: {} }, { connectionId: "mine" });
    expect(ops.listConnections).toHaveBeenCalledWith();
    expect(result).toEqual({ ok: true, value: [{ id: "primary", name: "Podman", engine: "podman", running: true }] });
  });

  it("reports an unknown op as a failure instead of throwing at the caller", async () => {
    const result = await dispatchEngineOp(fakeOps(), { op: "deployToProd", args: {} });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("deployToProd") });
  });

  it("turns a rejected engine call into a failure carrying the engine's own message", async () => {
    const ops = fakeOps({
      startContainer: vi.fn(async () => {
        throw new Error('Connection "gone" is not running.');
      }),
    });
    const result = await dispatchEngineOp(ops, { op: "startContainer", args: { id: "c1" } });
    expect(result).toEqual({ ok: false, error: 'Connection "gone" is not running.' });
  });

  it("fails cleanly when the app has no engine operations bound at all", async () => {
    const result = await dispatchEngineOp(undefined, { op: "listContainers", args: {} });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("no container engine") });
  });
});
