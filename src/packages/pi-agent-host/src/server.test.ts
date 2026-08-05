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
    setSystemContext: vi.fn(),
    runCommand: vi.fn(async () => ({ ok: true as const, data: { ran: true } })),
    importSession: vi.fn(async () => {}),
    checkProvider: vi.fn(async () => ({ reachable: true, status: 200 })),
    setGatewayCredential: vi.fn(async () => undefined),
    selectModel: vi.fn(async (model: { id: string }) => ({ provider: "test", id: model.id })),
    plugins: {
      list: vi.fn(() => ({ configured: [{ source: "npm:@foo/bar", scope: "user" as const, filtered: false }] })),
      install: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      checkUpdates: vi.fn(async () => ["npm:@foo/bar"]),
      setEnabled: vi.fn(async () => {}),
    },
    listResources: vi.fn(() => ({
      extensions: [],
      commands: [{ name: "probe" }],
      skills: [],
      prompts: [],
      builtins: [],
    })),
    reload: vi.fn(async () => {}),
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

  // A command this host does not know is how an app newer than its container image arrives. Answering only with a
  // bare error event leaves the caller's request pending until its timeout, which reads as a hung session — so the
  // id gets a failed response too, and the app can say what is wrong straight away.
  it("fails the request when the command type is unknown, instead of leaving it pending", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    h.sent.length = 0;
    await h.attached.handleFrame(JSON.stringify({ id: "c2", type: "from_a_newer_app", text: "x" }));
    expect(parsed(h.sent)).toEqual([
      { type: "error", message: "unknown command type: from_a_newer_app" },
      { type: "response", id: "c2", success: false, error: "unknown command type: from_a_newer_app" },
    ]);
  });

  it("routes a host_response to the session handle", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    await h.attached.handleFrame(
      encodeCommand({ id: "c2", type: "host_response", requestId: "r1", ok: true, value: "yes" }),
    );
    expect(h.session.settleHostResponse).toHaveBeenCalledWith("r1", { ok: true, value: "yes", error: undefined });
  });

  it("routes the app's project context to the session", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    h.sent.length = 0;
    await h.attached.handleFrame(encodeCommand({ id: "c2", type: "set_system_context", text: "## rules\n\nbe terse" }));
    expect(h.session.setSystemContext).toHaveBeenCalledWith("## rules\n\nbe terse");
    expect(parsed(h.sent)).toEqual([{ type: "response", id: "c2", success: true }]);
  });

  // End to end through the codec: a command name missing from the protocol's own set is refused before it reaches the
  // dispatcher, so "the case exists" proves nothing on its own.
  it("answers a model switch with what the session chose", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    h.sent.length = 0;
    await h.attached.handleFrame(
      encodeCommand({ id: "c2", type: "model_select", model: { id: "b", contextWindow: 8192 } }),
    );
    expect(h.session.selectModel).toHaveBeenCalledWith({ id: "b", contextWindow: 8192 });
    expect(parsed(h.sent)).toEqual([
      { type: "response", id: "c2", success: true, result: { provider: "test", id: "b" } },
    ]);
  });

  it("answers plugins_list with the payload as the response result", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    h.sent.length = 0;
    await h.attached.handleFrame(encodeCommand({ id: "c2", type: "plugins_list" }));
    expect(parsed(h.sent)).toEqual([
      {
        type: "response",
        id: "c2",
        success: true,
        result: { configured: [{ source: "npm:@foo/bar", scope: "user", filtered: false }] },
      },
    ]);
  });

  it("answers resources_list with the contributed resources", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    h.sent.length = 0;
    await h.attached.handleFrame(encodeCommand({ id: "c2", type: "resources_list" }));
    expect(parsed(h.sent)[0].result.commands).toEqual([{ name: "probe" }]);
  });

  it("routes the plugin mutations to the service with their scope", async () => {
    const h = harness();
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    await h.attached.handleFrame(
      encodeCommand({ id: "c2", type: "plugins_install", source: "npm:@foo/baz", scope: "user" }),
    );
    await h.attached.handleFrame(
      encodeCommand({ id: "c3", type: "plugins_remove", source: "npm:@foo/bar", scope: "user" }),
    );
    await h.attached.handleFrame(
      encodeCommand({ id: "c4", type: "plugins_set_enabled", source: "npm:@foo/bar", enabled: false, scope: "user" }),
    );
    await h.attached.handleFrame(encodeCommand({ id: "c5", type: "plugins_update" }));
    await h.attached.handleFrame(encodeCommand({ id: "c6", type: "session_reload" }));
    expect(h.session.plugins.install).toHaveBeenCalledWith("npm:@foo/baz", "user");
    expect(h.session.plugins.remove).toHaveBeenCalledWith("npm:@foo/bar", "user");
    expect(h.session.plugins.setEnabled).toHaveBeenCalledWith("npm:@foo/bar", false, "user");
    expect(h.session.plugins.update).toHaveBeenCalledWith(undefined);
    expect(h.session.reload).toHaveBeenCalled();
  });

  it("reports a failing plugin install as an unsuccessful response", async () => {
    const h = harness();
    (h.session.plugins.install as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("registry down"));
    await h.attached.handleFrame(encodeCommand({ id: "c1", type: "hello", token: "tok", protocolVersion: 1 }));
    h.sent.length = 0;
    await h.attached.handleFrame(
      encodeCommand({ id: "c2", type: "plugins_install", source: "npm:@foo/baz", scope: "user" }),
    );
    expect(parsed(h.sent)).toEqual([{ type: "response", id: "c2", success: false, error: "registry down" }]);
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
