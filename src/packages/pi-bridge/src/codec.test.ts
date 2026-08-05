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

  it("round-trips a surface frame with its slot and placement", () => {
    const decoded = decodeEvent(
      encodeEvent({
        type: "surface_frame",
        surfaceId: "surface-1",
        slot: { kind: "tool", toolCallId: "t1", slot: "result" },
        lines: ["\x1b[32mok\x1b[39m"],
        focus: true,
        overlay: true,
        placement: { anchor: "top-center", width: "50%" },
      }),
    );
    expect(decoded).toEqual({
      type: "surface_frame",
      surfaceId: "surface-1",
      slot: { kind: "tool", toolCallId: "t1", slot: "result" },
      lines: ["\x1b[32mok\x1b[39m"],
      focus: true,
      overlay: true,
      placement: { anchor: "top-center", width: "50%" },
    });
  });

  it("round-trips a surface_closed event", () => {
    expect(decodeEvent(encodeEvent({ type: "surface_closed", surfaceId: "surface-1" }))).toEqual({
      type: "surface_closed",
      surfaceId: "surface-1",
    });
  });

  it("round-trips surface input and resize commands", () => {
    const input = encodeCommand({ id: "c1", type: "surface_input", surfaceId: "surface-1", data: "\x1b[A" });
    expect(decodeCommand(input)).toEqual({ id: "c1", type: "surface_input", surfaceId: "surface-1", data: "\x1b[A" });
    const resize = encodeCommand({ id: "c2", type: "surface_resize", surfaceId: "surface-1", columns: 96 });
    expect(decodeCommand(resize)).toEqual({ id: "c2", type: "surface_resize", surfaceId: "surface-1", columns: 96 });
  });

  it("round-trips a set_theme command carrying the app palette", () => {
    const palette = {
      chrome: "#1b2027",
      bg: "#22282f",
      surface: "#2a313a",
      border: "#39424d",
      text: "#e8edf2",
      textMuted: "#9aa5b1",
      accent: "#14b8a6",
      success: "#2ea043",
      warning: "#d29922",
      error: "#f85149",
    };
    expect(decodeCommand(encodeCommand({ id: "c3", type: "set_theme", palette }))).toEqual({
      id: "c3",
      type: "set_theme",
      palette,
    });
  });

  it("round-trips the plugin commands with their scope", () => {
    const install = encodeCommand({ id: "c1", type: "plugins_install", source: "npm:@foo/bar", scope: "user" });
    expect(decodeCommand(install)).toEqual({
      id: "c1",
      type: "plugins_install",
      source: "npm:@foo/bar",
      scope: "user",
    });
    const toggle = encodeCommand({
      id: "c2",
      type: "plugins_set_enabled",
      source: "npm:@foo/bar",
      enabled: false,
      scope: "project",
    });
    expect(decodeCommand(toggle)).toEqual({
      id: "c2",
      type: "plugins_set_enabled",
      source: "npm:@foo/bar",
      enabled: false,
      scope: "project",
    });
    for (const type of [
      "plugins_list",
      "plugins_update",
      "plugins_check_updates",
      "resources_list",
      "session_reload",
    ]) {
      expect(decodeCommand(JSON.stringify({ id: "c3", type }))).toMatchObject({ type });
    }
  });

  it("round-trips a response carrying a result payload", () => {
    const configured = [{ source: "npm:@foo/bar", scope: "user" as const, filtered: true, autoload: false }];
    const decoded = decodeEvent(encodeEvent({ type: "response", id: "c1", success: true, result: { configured } }));
    expect(decoded).toEqual({ type: "response", id: "c1", success: true, result: { configured } });
  });

  it("round-trips the plugin progress and change events", () => {
    const progress = encodeEvent({
      type: "plugin_progress",
      source: "npm:@foo/bar",
      action: "install",
      phase: "progress",
      message: "fetching",
    });
    expect(decodeEvent(progress)).toEqual({
      type: "plugin_progress",
      source: "npm:@foo/bar",
      action: "install",
      phase: "progress",
      message: "fetching",
    });
    expect(decodeEvent(encodeEvent({ type: "plugins_changed" }))).toEqual({ type: "plugins_changed" });
  });

  it("no longer accepts the superseded ui_request event", () => {
    expect(() => decodeEvent(JSON.stringify({ type: "ui_request", requestId: "r1", method: "confirm" }))).toThrow(
      BridgeProtocolError,
    );
  });
});
