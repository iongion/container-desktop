import { describe, expect, it, vi } from "vitest";
import type { EngineOps } from "@/container-client/engineOps";
import { DEFAULT_MCP_PORT, type McpSettings } from "@/container-client/mcpSettings";
import { createMcpHost, MCP_REQUEST_EVENT, type McpHostDeps } from "@/platform/tauri/mcpHost";

type Handler = (event: { payload: any }) => void;

const OFF: McpSettings = { enabled: false, port: DEFAULT_MCP_PORT, mode: "read-only" };
const ON: McpSettings = { enabled: true, port: 18080, mode: "read-only" };

// A fake shell: `listen` keeps the handler so a test can play the Rust side's `mcp://request`, and `invoke` answers
// the mcp_* commands, recording what the webview sent back.
function makeHost(overrides: Partial<McpHostDeps> = {}, commands: Record<string, (args: any) => unknown> = {}) {
  const handlers = new Map<string, Handler>();
  const unlisten = vi.fn();
  const replies: { id: number; body: string }[] = [];
  const invoke = vi.fn(async (command: string, args?: any) => {
    if (command in commands) return commands[command](args);
    if (command === "mcp_reply") replies.push(args);
    if (command === "mcp_start") return { running: true, port: args.port, mode: args.mode };
    if (command === "mcp_stop" || command === "mcp_status") return { running: false };
    return undefined;
  });
  const engineOps = {
    listContainers: vi.fn(async () => [{ Id: "web", Name: "web", State: "running" }]),
    stopContainer: vi.fn(async () => true),
  };
  const deps: McpHostDeps = {
    invoke,
    listen: vi.fn(async (event: string, handler: Handler) => {
      handlers.set(event, handler);
      return unlisten;
    }),
    engineOps: engineOps as unknown as EngineOps,
    serverVersion: "6.1.0",
    readSettings: vi.fn(async () => ON),
    logger: { error: vi.fn() },
    ...overrides,
  };
  const host = createMcpHost(deps);
  // Play one request from the listener and wait for the webview's answer to reach mcp_reply.
  const request = async (id: number, message: unknown) => {
    const before = replies.length;
    handlers.get(MCP_REQUEST_EVENT)?.({ payload: { id, body: JSON.stringify(message) } });
    await vi.waitFor(() => expect(replies.length).toBe(before + 1));
    const { body } = replies[replies.length - 1];
    return { id: replies[replies.length - 1].id, body: body === "" ? undefined : JSON.parse(body) };
  };
  return { host, deps, invoke, unlisten, request, handlers };
}

const call = (id: number, name: string, args: unknown = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("createMcpHost: answering the listener's requests", () => {
  it("answers a request through the protocol core and sends the reply back under its id", async () => {
    const { request } = makeHost();
    const reply = await request(41, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(reply.id).toBe(41);
    expect(reply.body.result.protocolVersion).toBe("2025-06-18");
    expect(reply.body.result.serverInfo).toEqual({ name: "container-desktop", version: "6.1.0" });
  });

  it("runs tool calls on the in-realm engine", async () => {
    const { request, deps } = makeHost();
    const reply = await request(2, call(9, "listContainers"));
    expect(reply.body.result.structuredContent).toEqual({ result: [{ id: "web", name: "web", state: "running" }] });
    expect(deps.engineOps.listContainers).toHaveBeenCalledTimes(1);
  });

  it("sends an empty reply for a notification, which the listener answers 202", async () => {
    const { request } = makeHost();
    const reply = await request(3, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(reply).toEqual({ id: 3, body: undefined });
  });

  it("reads the mode from the settings for every request, so switching to allow applies to the next call", async () => {
    let mode: McpSettings["mode"] = "read-only";
    const { request } = makeHost({ readSettings: vi.fn(async () => ({ ...ON, mode })) });
    const refused = await request(4, call(1, "stopContainer", { id: "web" }));
    expect(refused.body.result.isError).toBe(true);
    expect(refused.body.result.content[0].text).toContain("read-only");
    mode = "allow";
    const allowed = await request(5, call(2, "stopContainer", { id: "web" }));
    expect(allowed.body.result.isError).toBeUndefined();
    expect(allowed.body.result.structuredContent).toEqual({ result: true });
  });

  it("stays read-only when the settings cannot be read", async () => {
    const { request, deps } = makeHost({ readSettings: vi.fn(async () => Promise.reject(new Error("EACCES"))) });
    const reply = await request(6, call(1, "stopContainer", { id: "web" }));
    expect(reply.body.result.content[0].text).toContain("read-only");
    expect(deps.engineOps.stopContainer).not.toHaveBeenCalled();
  });

  it("still answers, with a JSON-RPC error, when the core throws", async () => {
    const engineOps = {
      get listContainers(): never {
        throw new Error("boom");
      },
    };
    const { request } = makeHost({ engineOps: engineOps as unknown as EngineOps });
    const reply = await request(7, call(3, "listContainers"));
    expect(reply.body.error.code).toBe(-32603);
  });

  it("stops listening on dispose", async () => {
    const { host, unlisten, deps } = makeHost();
    await host.apply(OFF);
    host.dispose();
    expect(deps.listen).toHaveBeenCalledWith(MCP_REQUEST_EVENT, expect.any(Function));
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("createMcpHost: the controller", () => {
  it("starts the listener on the configured port and mode, only once it can answer", async () => {
    const { host, invoke, deps } = makeHost();
    const status = await host.apply(ON);
    expect(deps.listen).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("mcp_start", { port: 18080, mode: "read-only", allowDegraded: false });
    expect(status).toEqual({ running: true, port: 18080, mode: "read-only" });
  });

  it("does not start the listener when this window cannot receive its requests", async () => {
    const { host, invoke } = makeHost({ listen: vi.fn(async () => Promise.reject(new Error("no event plugin"))) });
    await expect(host.apply(ON)).resolves.toEqual({ running: false, error: "no event plugin" });
    expect(invoke).not.toHaveBeenCalledWith("mcp_start", expect.anything());
  });

  it("stops the listener when the settings turn it off", async () => {
    const { host, invoke } = makeHost();
    await expect(host.apply(OFF)).resolves.toEqual({ running: false });
    expect(invoke).toHaveBeenCalledWith("mcp_stop");
    expect(invoke).not.toHaveBeenCalledWith("mcp_start", expect.anything());
  });

  it("applies the saved settings when given none, as at boot", async () => {
    const { host, invoke, deps } = makeHost();
    await host.apply();
    expect(deps.readSettings).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("mcp_start", { port: 18080, mode: "read-only", allowDegraded: false });
  });

  it("passes the user's consent to keep the token outside an unavailable OS keychain", async () => {
    const { host, invoke } = makeHost();
    await host.apply(ON, { allowDegraded: true });
    expect(invoke).toHaveBeenCalledWith("mcp_start", { port: 18080, mode: "read-only", allowDegraded: true });
  });

  it("never throws on a failed start: the status carries the reason", async () => {
    const { host } = makeHost(
      {},
      {
        mcp_start: () => Promise.reject("The MCP server could not listen on 127.0.0.1:18080: Address in use"),
        mcp_status: () => ({
          running: false,
          error: "The MCP server could not listen on 127.0.0.1:18080: Address in use",
        }),
      },
    );
    await expect(host.apply(ON)).resolves.toEqual({
      running: false,
      error: "The MCP server could not listen on 127.0.0.1:18080: Address in use",
    });
  });

  it("reports the failure itself when the status has none", async () => {
    const { host } = makeHost({}, { mcp_start: () => Promise.reject(new Error("keychain locked")) });
    await expect(host.apply(ON)).resolves.toEqual({ running: false, error: "keychain locked" });
  });

  it("reads the status, the token and a regenerated token through their dedicated commands", async () => {
    const { host, invoke } = makeHost(
      {},
      {
        mcp_status: () => ({ running: true, port: 18080 }),
        mcp_token: () => "a".repeat(64),
        mcp_regenerate_token: () => "b".repeat(64),
      },
    );
    await expect(host.status()).resolves.toEqual({ running: true, port: 18080 });
    await expect(host.token()).resolves.toBe("a".repeat(64));
    await expect(host.regenerateToken({ allowDegraded: true })).resolves.toBe("b".repeat(64));
    expect(invoke).toHaveBeenCalledWith("mcp_token", { allowDegraded: false });
    expect(invoke).toHaveBeenCalledWith("mcp_regenerate_token", { allowDegraded: true });
  });
});
