import { describe, expect, it, vi } from "vitest";
import { dispatchEngineOp } from "@/mcp-server/core/engineOpDispatch";
import { fakeEngineOps } from "../support/fakeEngineOps";

describe("dispatchEngineOp", () => {
  it("invokes the named operation with its arguments and returns its value", async () => {
    const ops = fakeEngineOps();
    const result = await dispatchEngineOp(ops, { op: "inspectContainer", args: { id: "web" } });
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ Id: "web" }) });
    expect(ops.inspectContainer).toHaveBeenCalledWith({ id: "web" });
  });

  it("passes the arguments through as given, leaving the default connection to the engine layer", async () => {
    const ops = fakeEngineOps();
    await dispatchEngineOp(ops, { op: "listContainers", args: {} });
    await dispatchEngineOp(ops, { op: "listContainers", args: { connectionId: "docker" } });
    expect(ops.listContainers).toHaveBeenNthCalledWith(1, {});
    expect(ops.listContainers).toHaveBeenNthCalledWith(2, { connectionId: "docker" });
  });

  it("calls listConnections with no arguments, since it spans every connection", async () => {
    const ops = fakeEngineOps();
    const result = await dispatchEngineOp(ops, { op: "listConnections", args: {} });
    expect(ops.listConnections).toHaveBeenCalledWith();
    expect(result).toEqual({
      ok: true,
      value: [{ id: "podman", name: "Podman", engine: "podman", running: true, current: true }],
    });
  });

  // Names are checked against the tool list, never looked up on the port, so a prototype member cannot be reached.
  it("refuses a name outside the container tools, prototype members included", async () => {
    for (const op of ["deployToProd", "constructor", "toString", "__proto__", ""]) {
      const result = await dispatchEngineOp(fakeEngineOps(), { op, args: {} });
      expect(result).toEqual({ ok: false, error: `Unknown container operation: ${op}` });
    }
  });

  it("turns a rejected engine call into a failure carrying the engine's own message", async () => {
    const ops = fakeEngineOps({
      startContainer: vi.fn(async () => {
        throw new Error('Connection "gone" is not running.');
      }),
    });
    const result = await dispatchEngineOp(ops, { op: "startContainer", args: { id: "web" } });
    expect(result).toEqual({ ok: false, error: 'Connection "gone" is not running.' });
  });

  it("reports a thrown value that is not an Error as text", async () => {
    const ops = fakeEngineOps({
      listImages: vi.fn(async () => {
        throw "socket closed";
      }),
    });
    expect(await dispatchEngineOp(ops, { op: "listImages", args: {} })).toEqual({ ok: false, error: "socket closed" });
  });
});
