// The one place an `engine_op` host request becomes a call on the EngineOps port. Pure and dependency-free
// (core): the container names an operation, this validates the name against the app's own container tool list
// and answers with a value or a reason — never a throw, because the caller is answering a blocked agent and a
// rejected promise there would leave pi waiting on a request nothing settles.
//
// Names are checked against CONTAINER_TOOL_NAMES rather than reflected off the port, so `constructor`,
// `toString` and anything else reachable through the prototype can never be dispatched.

import type { EngineOpRequest, EngineOpResult } from "@/pi-bridge/protocol";

import { isContainerToolName } from "./toolNames";
import type { EngineOps } from "./types";

// The port's methods differ in argument shape but agree in kind: an optional single options object. Stating
// that once here is what lets one dispatcher stand in for twenty-one signatures.
type EngineOpFn = (arg?: Record<string, unknown>) => unknown;

// Global by nature: its whole purpose is telling the model which other connections exist, so scoping it to the
// session's connection would answer the question with the answer already assumed.
const UNSCOPED_OPS = new Set<string>(["listConnections"]);

export function isEngineOpName(value: string): boolean {
  return isContainerToolName(value);
}

// Narrow an untrusted host_request payload into a request, or nothing. A payload naming a tool that is not a
// container operation is not an error to report to the model — it is a request this app does not serve.
export function parseEngineOpRequest(payload: Record<string, unknown>): EngineOpRequest | undefined {
  const op = payload.op;
  if (typeof op !== "string" || !isEngineOpName(op)) return undefined;
  const args = payload.args;
  const usable = typeof args === "object" && args !== null && !Array.isArray(args);
  return { op, args: usable ? (args as Record<string, unknown>) : {} };
}

// A model that omits the connection acts where its session runs; one that names a connection wins. Same rule as
// the execution selector's scopeEngineOps, so the two ways a tool reaches an engine agree.
function withConnection(args: Record<string, unknown>, connectionId?: string): Record<string, unknown> {
  const provided = typeof args.connectionId === "string" && args.connectionId ? args.connectionId : connectionId;
  return provided ? { ...args, connectionId: provided } : args;
}

export async function dispatchEngineOp(
  ops: EngineOps | undefined,
  request: EngineOpRequest,
  defaults?: { connectionId?: string },
): Promise<EngineOpResult> {
  if (!ops) {
    return { ok: false, error: "This app has no container engine operations bound, so container tools cannot run." };
  }
  const fn = isEngineOpName(request.op)
    ? (ops as unknown as Record<string, EngineOpFn>)[request.op]
    : (undefined as EngineOpFn | undefined);
  if (typeof fn !== "function") {
    return { ok: false, error: `Unknown container operation: ${request.op}` };
  }
  try {
    const value = UNSCOPED_OPS.has(request.op)
      ? await fn()
      : await fn(withConnection(request.args ?? {}, defaults?.connectionId));
    return { ok: true, value };
  } catch (error) {
    // The engine's own message is the useful one — "Connection X is not running" tells the model what to do
    // next, where a generic failure would make it retry the same call.
    return { ok: false, error: (error as Error).message };
  }
}
