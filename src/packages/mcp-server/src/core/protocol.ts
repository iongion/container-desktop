// MCP over JSON-RPC 2.0 as one pure function: a raw message in, the serialized reply out, or nothing when the
// message expects no reply (a notification, or a response from the client). It speaks the handshake-based MCP
// revisions and is stateless, so every message is answered on its own; the transport hands each request body here
// and writes back what comes out. Tool calls run on EngineOps under the user's permission mode.

import type { EngineOps } from "@/container-client/engineOps";
import { redactPayload, redactText } from "@/utils/redact";
import { dispatchEngineOp } from "./engineOpDispatch";
import { isToolAllowed, type McpPermissionMode } from "./permissions";
import { validateToolArguments } from "./toolArguments";
import { shippedMcpTools } from "./toolCatalogue";
import { isContainerToolName } from "./toolNames";
import { summarizeToolResult } from "./toolResultSummaries";

// Newest first: a client asking for a version not in this list is answered with the first one.
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const MCP_SERVER_NAME = "container-desktop";

export interface McpServerDeps {
  // Reported to clients as `serverInfo.version`.
  serverVersion: string;
  // Where tool calls run.
  engineOps: EngineOps;
  // The user's setting, read for every message, so a change applies to the next call.
  mode: McpPermissionMode;
}

type JsonRpcId = string | number;
type Params = Record<string, unknown>;

type RpcReply =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string } };

interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Params;
  isError?: true;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// Thrown by a method handler to answer with a JSON-RPC error instead of a result.
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Params {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// MCP ids are strings or numbers, never null.
function isId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(id: JsonRpcId | null, code: number, message: string): RpcReply {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function initialize(params: Params, deps: McpServerDeps) {
  const requested = params.protocolVersion;
  if (typeof requested !== "string") {
    throw new RpcError(INVALID_PARAMS, "initialize needs the client's protocolVersion");
  }
  const supported = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested);
  return {
    protocolVersion: supported ? requested : MCP_PROTOCOL_VERSIONS[0],
    capabilities: { tools: {} },
    serverInfo: { name: MCP_SERVER_NAME, version: deps.serverVersion },
  };
}

// Every tool, whatever the mode: a client reads this list once per session, so a list that followed the mode would
// keep the changing tools from it until it reconnected. The mode is enforced on each call instead.
function listTools() {
  return { tools: shippedMcpTools() };
}

function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

// structuredContent has to be a JSON object, so a list, a text or a flag travels as `result`. The text block
// repeats it as JSON for clients that read only text.
function toolSuccess(value: unknown): ToolResult {
  const structured = redactPayload(isRecord(value) ? value : { result: value ?? null });
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured };
}

// Unknown tools and malformed calls are protocol errors. Refusals, arguments that fail the schema and engine
// failures are tool errors, which the client can show to whoever is calling and let them correct the call.
async function callTool(params: Params, deps: McpServerDeps): Promise<ToolResult> {
  const { name } = params;
  if (typeof name !== "string") throw new RpcError(INVALID_PARAMS, "tools/call needs the tool's name");
  if (!isContainerToolName(name)) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
  const args = params.arguments ?? {};
  if (!isRecord(args)) throw new RpcError(INVALID_PARAMS, "tools/call arguments must be an object");
  if (!isToolAllowed(deps.mode, name)) {
    return toolError(
      `${name} changes a container engine, and Container Desktop's MCP server is read-only. ` +
        `The user can turn on "Allow changes" in Settings → MCP server in Container Desktop; ${name} then works ` +
        "without reconnecting.",
    );
  }
  const invalid = validateToolArguments(name, args);
  if (invalid) return toolError(`Invalid arguments for ${name}: ${invalid}`);
  const outcome = await dispatchEngineOp(deps.engineOps, { op: name, args });
  return outcome.ok ? toolSuccess(summarizeToolResult(name, outcome.value)) : toolError(redactText(outcome.error));
}

const METHODS: Readonly<Record<string, (params: Params, deps: McpServerDeps) => unknown>> = {
  initialize,
  ping: () => ({}),
  "tools/list": listTools,
  "tools/call": callTool,
};

type Incoming =
  | { kind: "request"; id: JsonRpcId; method: string; params: unknown }
  | { kind: "no-reply" }
  | { kind: "invalid"; id: JsonRpcId | null; reason: string };

function classify(message: unknown): Incoming {
  if (Array.isArray(message)) {
    return { kind: "invalid", id: null, reason: "Invalid request: batches are not supported, send one message" };
  }
  if (!isRecord(message)) return { kind: "invalid", id: null, reason: "Invalid request: not a JSON object" };
  const hasId = Object.hasOwn(message, "id");
  const id = isId(message.id) ? message.id : null;
  if (hasId && id === null) return { kind: "invalid", id, reason: "Invalid request: id must be a string or number" };
  if (message.jsonrpc !== "2.0") return { kind: "invalid", id, reason: 'Invalid request: jsonrpc must be "2.0"' };
  if (typeof message.method !== "string") {
    // A response to a server-to-client request. This server sends none, so there is nothing to act on.
    const isResponse = Object.hasOwn(message, "result") || Object.hasOwn(message, "error");
    if (hasId && isResponse) return { kind: "no-reply" };
    return { kind: "invalid", id, reason: "Invalid request: method must be a string" };
  }
  if (id === null) return { kind: "no-reply" };
  return { kind: "request", id, method: message.method, params: message.params };
}

async function answer(id: JsonRpcId, method: string, params: unknown, deps: McpServerDeps): Promise<RpcReply> {
  try {
    // Own keys only, so `constructor` or `toString` never reach Object.prototype.
    if (!Object.hasOwn(METHODS, method)) throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
    if (params !== undefined && !isRecord(params)) throw new RpcError(INVALID_PARAMS, "params must be an object");
    return { jsonrpc: "2.0", id, result: await METHODS[method](params ?? {}, deps) };
  } catch (error) {
    if (error instanceof RpcError) return failure(id, error.code, error.message);
    return failure(id, INTERNAL_ERROR, `Internal error: ${redactText(errorMessage(error))}`);
  }
}

// A value JSON cannot carry (a BigInt, a cycle) becomes an internal error rather than a throw at the transport.
function serialize(reply: RpcReply): string {
  try {
    return JSON.stringify(reply);
  } catch (error) {
    return JSON.stringify(failure(reply.id, INTERNAL_ERROR, `Internal error: ${redactText(errorMessage(error))}`));
  }
}

export async function handleMcpMessage(raw: string, deps: McpServerDeps): Promise<string | undefined> {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return serialize(failure(null, PARSE_ERROR, "Parse error: the message is not valid JSON"));
  }
  const incoming = classify(message);
  if (incoming.kind === "no-reply") return undefined;
  if (incoming.kind === "invalid") return serialize(failure(incoming.id, INVALID_REQUEST, incoming.reason));
  return serialize(await answer(incoming.id, incoming.method, incoming.params, deps));
}
