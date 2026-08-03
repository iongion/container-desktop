import { describe, expect, it, vi } from "vitest";

import { attachBridgeConnection, type BridgeSessionHandle } from "@/pi-agent-host/server";
import { encodeCommand } from "@/pi-bridge/codec";

function harness(token = "tok") {
  const sent: string[] = [];
  const closed: Array<{ code: number; reason: string }> = [];
  const session: BridgeSessionHandle = {
    sessionId: "s1",
    cwd: "/workspace",
    model: "test/model",
    prompt: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    settleHostResponse: vi.fn(),
    surfaceInput: vi.fn(),
    surfaceResize: vi.fn(),
    setThemePalette: vi.fn(),
  };
  const attached = attachBridgeConnection(
    {
      send: (frame) => sent.push(frame),
      close: (code, reason) => closed.push({ code, reason }),
    },
    { token, session },
  );
  return { sent, closed, session, attached };
}

const parsed = (frames: string[]) => frames.map((frame) => JSON.parse(frame));

describe("attachBridgeConnection", () => {
  it("answers a valid hello with a response and a ready event", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    expect(parsed(h.sent)).toEqual([
      { type: "response", id: "c1", success: true },
      { type: "ready", protocolVersion: 1, sessionId: "s1", cwd: "/workspace", model: "test/model" },
    ]);
  });

  it("closes the connection when the token is wrong", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "nope", protocolVersion: 1 }));
    expect(h.closed).toEqual([{ code: 4401, reason: "unauthorized" }]);
  });

  it("closes the connection on a protocol version mismatch", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 99 }));
    expect(h.closed).toEqual([{ code: 4426, reason: "protocol version mismatch" }]);
  });

  it("rejects any command before hello", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c2", type: "prompt", text: "hi" }));
    expect(parsed(h.sent)).toEqual([{ type: "response", id: "c2", success: false, error: "handshake required" }]);
    expect(h.session.prompt).not.toHaveBeenCalled();
  });

  it("forwards a prompt after hello and reports success", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    h.sent.length = 0;
    await h.attached.handleFrame(encodeCommand({ id: "c2", type: "prompt", text: "hi" }));
    expect(h.session.prompt).toHaveBeenCalledWith("hi", undefined);
    expect(parsed(h.sent)).toEqual([{ type: "response", id: "c2", success: true }]);
  });

  it("reports a failing prompt as an unsuccessful response, not a throw", async () => {
    const h = harness();
    (h.session.prompt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("model exploded"));
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    h.sent.length = 0;
    await h.attached.handleFrame(encodeCommand({ id: "c2", type: "prompt", text: "hi" }));
    expect(parsed(h.sent)).toEqual([{ type: "response", id: "c2", success: false, error: "model exploded" }]);
  });

  it("answers an undecodable frame with an error event", async () => {
    const h = harness();
    await h.attached.handleFrame("{not json");
    expect(parsed(h.sent)[0].type).toBe("error");
  });

  it("routes a host_response to the session handle", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    await h.attached.handleFrame(
      encodeCommand({ id: "c2", type: "host_response", requestId: "r1", ok: true, value: "yes" }),
    );
    expect(h.session.settleHostResponse).toHaveBeenCalledWith("r1", { ok: true, value: "yes", error: undefined });
  });

  it("emit() only reaches the client after the handshake", async () => {
    const h = harness();
    h.attached.emit({ type: "idle" });
    expect(h.sent).toEqual([]);
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    h.sent.length = 0;
    h.attached.emit({ type: "idle" });
    expect(parsed(h.sent)).toEqual([{ type: "idle" }]);
  });
});
