import { describe, expect, it, vi } from "vitest";
import type { EngineOps } from "@/container-client/engineOps";
import { handleMcpMessage, MCP_PROTOCOL_VERSIONS, type McpServerDeps } from "@/mcp-server/core/protocol";
import { CONTAINER_TOOL_NAMES } from "@/mcp-server/core/toolNames";
import { fakeEngineOps } from "../support/fakeEngineOps";

function deps(overrides: Partial<McpServerDeps> = {}): McpServerDeps {
  return { serverVersion: "6.1.0", engineOps: fakeEngineOps(), mode: "read-only", ...overrides };
}

async function send(message: unknown, using: McpServerDeps = deps()) {
  const raw = typeof message === "string" ? message : JSON.stringify(message);
  const reply = await handleMcpMessage(raw, using);
  return reply === undefined ? undefined : JSON.parse(reply);
}

function request(id: number | string, method: string, params?: unknown) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

async function callTool(name: string, args: unknown, using: McpServerDeps = deps()) {
  return send(request(7, "tools/call", { name, arguments: args }), using);
}

describe("initialize", () => {
  it("supports the handshake-based MCP revisions, newest first", () => {
    expect(MCP_PROTOCOL_VERSIONS).toEqual(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
  });

  it("declares the tools capability and names the app and its version", async () => {
    const reply = await send(request(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {} }));
    expect(reply).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "container-desktop", version: "6.1.0" },
      },
    });
  });

  it("answers with the client's protocol version when it supports it", async () => {
    for (const version of MCP_PROTOCOL_VERSIONS) {
      const reply = await send(request(1, "initialize", { protocolVersion: version }));
      expect(reply.result.protocolVersion).toBe(version);
    }
  });

  it("answers with its newest version when it does not know the client's", async () => {
    const reply = await send(request(1, "initialize", { protocolVersion: "2099-01-01" }));
    expect(reply.result.protocolVersion).toBe("2025-11-25");
  });

  it("refuses an initialize that names no protocol version", async () => {
    const reply = await send(request(1, "initialize", { capabilities: {} }));
    expect(reply.error.code).toBe(-32602);
  });
});

describe("notifications and ping", () => {
  it("answers nothing to notifications/initialized", async () => {
    expect(await send({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
  });

  it("answers nothing to any notification, even one it does not know", async () => {
    expect(await send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 3 } })).toBeUndefined();
    expect(await send({ jsonrpc: "2.0", method: "made/up" })).toBeUndefined();
  });

  it("accepts a response from the client without answering it", async () => {
    expect(await send({ jsonrpc: "2.0", id: 4, result: {} })).toBeUndefined();
  });

  it("answers ping with an empty result", async () => {
    expect(await send(request("p", "ping"))).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
  });
});

describe("JSON-RPC errors", () => {
  it("answers unparseable JSON with a parse error", async () => {
    const reply = await send("{not json");
    expect(reply).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
  });

  it("refuses a batch", async () => {
    const reply = await send([request(1, "ping"), request(2, "ping")]);
    expect(reply).toMatchObject({ id: null, error: { code: -32600, message: expect.stringMatching(/batch/i) } });
  });

  it("refuses a message that is not a JSON-RPC 2.0 request", async () => {
    // `send` passes a string through as the raw message, so '"ping"' is a JSON string, not a request.
    for (const message of [42, '"ping"', null, { id: 1, method: "ping" }, { jsonrpc: "1.0", id: 1, method: "ping" }]) {
      expect((await send(message)).error.code).toBe(-32600);
    }
  });

  it("echoes a usable id on an invalid request, and null otherwise", async () => {
    expect(await send({ jsonrpc: "1.0", id: 9, method: "ping" })).toMatchObject({ id: 9 });
    expect(await send({ jsonrpc: "2.0", id: null, method: "ping" })).toMatchObject({
      id: null,
      error: { code: -32600 },
    });
    expect(await send({ jsonrpc: "2.0", id: { a: 1 }, method: "ping" })).toMatchObject({ id: null });
  });

  it("refuses a request whose method is not a string", async () => {
    expect((await send({ jsonrpc: "2.0", id: 1, method: 5 })).error.code).toBe(-32600);
  });

  it("answers a method it does not offer with method not found", async () => {
    for (const method of [
      "resources/list",
      "prompts/list",
      "server/discover",
      "constructor",
      "toString",
      "__proto__",
    ]) {
      expect(await send(request(3, method))).toMatchObject({ id: 3, error: { code: -32601 } });
    }
  });

  it("refuses params that are not an object", async () => {
    expect((await send(request(3, "tools/list", [1, 2]))).error.code).toBe(-32602);
  });
});

describe("tools/list", () => {
  // A client reads the list once per session, so a list that followed the mode would hide the changing tools until
  // it reconnected; the mode is enforced on the call instead.
  it("lists every tool in either mode", async () => {
    for (const mode of ["read-only", "allow"] as const) {
      const reply = await send(request(1, "tools/list", {}), deps({ mode }));
      expect(reply.result.tools.map((tool: { name: string }) => tool.name)).toEqual([...CONTAINER_TOOL_NAMES]);
    }
  });

  it("describes each tool with a title, a description, an input schema and annotations", async () => {
    const reply = await send(request(1, "tools/list"), deps({ mode: "allow" }));
    const remove = reply.result.tools.find((tool: { name: string }) => tool.name === "removeVolume");
    expect(Object.keys(remove).sort()).toEqual(["annotations", "description", "inputSchema", "name", "title"]);
    expect(remove.inputSchema).toMatchObject({ type: "object", required: ["id"] });
    expect(remove.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe("tools/call", () => {
  it("returns a read as structured content plus one text block carrying the same JSON", async () => {
    const reply = await callTool("listContainers", {});
    const result = reply.result;
    expect(result.structuredContent).toEqual({
      result: [{ id: "web", name: "web", image: "nginx", state: "running" }],
    });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent) }]);
    expect(result.isError).toBeUndefined();
  });

  it("uses an object value as the structured content itself", async () => {
    const reply = await callTool("inspectNetwork", { id: "n1" });
    expect(reply.result.structuredContent).toEqual({ id: "n1", name: "bridge" });
  });

  it("treats omitted arguments as none", async () => {
    const reply = await send(request(7, "tools/call", { name: "listVolumes" }));
    expect(reply.result.structuredContent).toEqual({ result: [{ name: "data" }] });
  });

  it("redacts secrets in both the structured content and the text", async () => {
    const inspectContainer = vi.fn(async () => ({
      Id: "web",
      Config: { Env: ["FOO_TOKEN=secret", "PATH=/usr/bin"] },
    }));
    const reply = await callTool(
      "inspectContainer",
      { id: "web" },
      deps({ engineOps: fakeEngineOps({ inspectContainer }) }),
    );
    expect(reply.result.structuredContent.Config.Env).toEqual(["FOO_TOKEN=[REDACTED]", "PATH=/usr/bin"]);
    expect(reply.result.content[0].text).not.toContain("secret");
    expect(reply.result.content[0].text).toContain("FOO_TOKEN=[REDACTED]");
  });

  it("refuses a change while read-only, with a tool error that says why, and never reaches the engine", async () => {
    const engineOps = fakeEngineOps();
    const reply = await callTool("stopContainer", { id: "web" }, deps({ engineOps }));
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toMatch(/read-only/);
    // The client cannot change the mode itself, so the refusal names where the user does.
    expect(reply.result.content[0].text).toContain('"Allow changes" in Settings → MCP server');
    expect(engineOps.stopContainer).not.toHaveBeenCalled();
  });

  it("runs a change once the user allows it", async () => {
    const using = deps({ mode: "allow" });
    const reply = await callTool("stopContainer", { id: "web" }, using);
    expect(reply.result).toEqual({
      content: [{ type: "text", text: '{"result":true}' }],
      structuredContent: { result: true },
    });
    const after = await callTool("inspectContainer", { id: "web" }, using);
    expect(after.result.structuredContent.State).toBe("exited");
  });

  it("answers an unknown tool with invalid params", async () => {
    const reply = await callTool("deployToProd", {});
    expect(reply).toMatchObject({ id: 7, error: { code: -32602, message: "Unknown tool: deployToProd" } });
  });

  it("answers a call with no tool name, or arguments that are not an object, with invalid params", async () => {
    expect((await send(request(7, "tools/call", { arguments: {} }))).error.code).toBe(-32602);
    expect((await send(request(7, "tools/call", { name: "listImages", arguments: [1] }))).error.code).toBe(-32602);
  });

  // MCP 2025-11-25 reports input validation as a tool error, so the caller can correct the call and retry.
  it("answers arguments that fail the schema with a tool error carrying the validator's message", async () => {
    const engineOps: EngineOps = fakeEngineOps();
    const reply = await callTool("getContainerLogs", { id: "web", tail: 9000 }, deps({ engineOps }));
    expect(reply.result).toEqual({
      content: [{ type: "text", text: "Invalid arguments for getContainerLogs: arguments/tail must be <= 5000" }],
      isError: true,
    });
    expect(engineOps.getContainerLogs).not.toHaveBeenCalled();
  });

  it("answers an engine failure with a tool error carrying the engine's message, redacted", async () => {
    const pullImage = vi.fn(async () => {
      throw new Error("pull failed: https://alice:hunter2@registry.example/v2");
    });
    const using = deps({ mode: "allow", engineOps: fakeEngineOps({ pullImage }) });
    const reply = await callTool("pullImage", { reference: "registry.example/app" }, using);
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toBe("pull failed: https://alice:[REDACTED]@registry.example/v2");
  });

  it("answers a value JSON cannot carry with an internal error instead of throwing", async () => {
    const getContainerStats = vi.fn(async () => ({ name: "web", huge: 10n }) as never);
    const reply = await callTool(
      "getContainerStats",
      { id: "web" },
      deps({ engineOps: fakeEngineOps({ getContainerStats }) }),
    );
    expect(reply).toMatchObject({ id: 7, error: { code: -32603 } });
  });
});
