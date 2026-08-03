import { describe, expect, it } from "vitest";

import { decodeCommand, decodeEvent, encodeCommand, encodeEvent } from "@/pi-bridge/codec";
import { BridgeProtocolError, PI_BRIDGE_PROTOCOL_VERSION } from "@/pi-bridge/protocol";

describe("pi-bridge codec", () => {
  it("round-trips a prompt command", () => {
    const decoded = decodeCommand(encodeCommand({ id: "c1", type: "prompt", text: "hello" }));
    expect(decoded).toEqual({ id: "c1", type: "prompt", text: "hello" });
  });

  it("round-trips an assistant delta event", () => {
    const decoded = decodeEvent(encodeEvent({ type: "assistant_delta", text: "hi" }));
    expect(decoded).toEqual({ type: "assistant_delta", text: "hi" });
  });

  it("round-trips a ready event carrying the protocol version", () => {
    const decoded = decodeEvent(
      encodeEvent({
        type: "ready",
        protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
        sessionId: "s1",
        cwd: "/workspace",
      }),
    );
    expect(decoded).toEqual({
      type: "ready",
      protocolVersion: 1,
      sessionId: "s1",
      cwd: "/workspace",
    });
  });

  it("rejects a command with an unknown type", () => {
    expect(() => decodeCommand(JSON.stringify({ id: "c1", type: "launch_missiles" }))).toThrow(BridgeProtocolError);
  });

  it("rejects a command with no id", () => {
    expect(() => decodeCommand(JSON.stringify({ type: "prompt", text: "hi" }))).toThrow(BridgeProtocolError);
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeEvent("{not json")).toThrow(BridgeProtocolError);
  });

  it("round-trips a host_request event", () => {
    const decoded = decodeEvent(
      encodeEvent({
        type: "host_request",
        requestId: "r1",
        method: "confirm",
        payload: { title: "Allow?", message: "rm -rf build" },
        timeoutMs: 30000,
      }),
    );
    expect(decoded).toMatchObject({ type: "host_request", requestId: "r1", method: "confirm" });
  });

  it("round-trips a host_response command", () => {
    const decoded = decodeCommand(
      encodeCommand({ id: "c9", type: "host_response", requestId: "r1", ok: true, value: true }),
    );
    expect(decoded).toEqual({ id: "c9", type: "host_response", requestId: "r1", ok: true, value: true });
  });

  it("no longer accepts the superseded ui_request event", () => {
    expect(() => decodeEvent(JSON.stringify({ type: "ui_request", requestId: "r1", method: "confirm" }))).toThrow(
      BridgeProtocolError,
    );
  });
});
