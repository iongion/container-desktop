// The one place a tool call becomes a call on the EngineOps port. It answers with a value or a reason, never a
// throw, so an engine failure reaches the MCP client as a tool error it can act on.
//
// Names are checked against CONTAINER_TOOL_NAMES rather than looked up on the port, so `constructor`, `toString`
// and anything else reachable through the prototype can never be dispatched.

import type { EngineOps } from "@/container-client/engineOps";
import { isContainerToolName } from "./toolNames";

// One container operation: the op name is the container tool's name.
export interface EngineOpRequest {
  op: string;
  args?: Record<string, unknown>;
}

export type EngineOpResult = { ok: true; value?: unknown } | { ok: false; error: string };

// The port's methods differ in argument shape but agree in kind: an optional single options object. Stating that
// once here is what lets one dispatcher stand in for twenty-one signatures.
type EngineOpFn = (arg?: Record<string, unknown>) => unknown;

// Spans every connection, so it takes no arguments at all.
const UNSCOPED_OPS = new Set<string>(["listConnections"]);

export async function dispatchEngineOp(ops: EngineOps, request: EngineOpRequest): Promise<EngineOpResult> {
  const fn = isContainerToolName(request.op)
    ? (ops as unknown as Record<string, EngineOpFn>)[request.op]
    : (undefined as EngineOpFn | undefined);
  if (typeof fn !== "function") {
    return { ok: false, error: `Unknown container operation: ${request.op}` };
  }
  try {
    const value = UNSCOPED_OPS.has(request.op) ? await fn.call(ops) : await fn.call(ops, request.args ?? {});
    return { ok: true, value };
  } catch (error) {
    // The engine's own message is the useful one: "Connection X is not running" says what to do next.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
