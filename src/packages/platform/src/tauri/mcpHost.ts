// The MCP server's webview half under Tauri. The Rust listener (src-tauri/src/mcp/) owns the socket, the request
// rules and the token, and hands each admitted request body here as an `mcp://request` event. The protocol core
// answers it over the in-realm EngineOps, under the mode read from the settings for that very request, and the
// answer goes back through `mcp_reply` (an empty one means "nothing to say", which the listener answers 202). The
// controller runs the listener from the settings and gives the Settings screen its status and token.

import type { EngineOps } from "@/container-client/engineOps";
import type { McpSettings } from "@/container-client/mcpSettings";
import { DEFAULT_MCP_PERMISSION_MODE } from "@/mcp-server/core/permissions";
import { handleMcpMessage } from "@/mcp-server/core/protocol";
import type { McpController, McpStatus, McpTokenOptions } from "@/platform/mcpIpc";

// Matches MCP_REQUEST_EVENT in src-tauri/src/mcp/commands.rs.
export const MCP_REQUEST_EVENT = "mcp://request";

// What the core never produces on its own: it answers every failure itself. This covers a throw that escapes it,
// so the request still gets an answer instead of waiting out the listener's timeout.
const INTERNAL_ERROR_REPLY = JSON.stringify({
  jsonrpc: "2.0",
  id: null,
  error: { code: -32603, message: "Internal error" },
});

interface McpRequestEvent {
  id: number;
  body: string;
}

export interface McpHostDeps {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<any>;
  listen: (event: string, handler: (event: { payload: any }) => void) => Promise<() => void>;
  engineOps: EngineOps;
  serverVersion: string;
  readSettings: () => Promise<McpSettings>;
  logger: { error: (...args: unknown[]) => void };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function answer(deps: McpHostDeps, request: McpRequestEvent): Promise<void> {
  // Settings that cannot be read leave the server read-only, never wider.
  const mode = await deps.readSettings().then(
    (settings) => settings.mode,
    () => DEFAULT_MCP_PERMISSION_MODE,
  );
  const reply = await handleMcpMessage(request.body, {
    serverVersion: deps.serverVersion,
    engineOps: deps.engineOps,
    mode,
  }).catch(() => INTERNAL_ERROR_REPLY);
  await deps
    .invoke("mcp_reply", { id: request.id, body: reply ?? "" })
    .catch((error) => deps.logger.error("MCP reply could not reach the listener", errorMessage(error)));
}

export function createMcpHost(deps: McpHostDeps): McpController {
  let unlisten: (() => void) | undefined;
  let disposed = false;
  // The listener is started only once this window can answer, so no request waits for a handler that is not there.
  const listening = deps
    .listen(MCP_REQUEST_EVENT, (event) => {
      void answer(deps, event.payload as McpRequestEvent);
    })
    .then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
  // apply() awaits it and reports a failure in the status; this only keeps a failure before then from going unhandled.
  listening.catch(() => undefined);

  const status = (): Promise<McpStatus> => deps.invoke("mcp_status");
  const tokenArgs = (options: McpTokenOptions = {}) => ({ allowDegraded: options.allowDegraded === true });

  return {
    async apply(settings, options) {
      try {
        await listening;
        const target = settings ?? (await deps.readSettings());
        if (!target.enabled) return await deps.invoke("mcp_stop");
        return await deps.invoke("mcp_start", { port: target.port, mode: target.mode, ...tokenArgs(options) });
      } catch (error) {
        const current: McpStatus = await status().catch(() => ({ running: false }));
        return { ...current, error: current.error ?? errorMessage(error) };
      }
    },
    status,
    token: (options) => deps.invoke("mcp_token", tokenArgs(options)),
    regenerateToken: (options) => deps.invoke("mcp_regenerate_token", tokenArgs(options)),
    dispose() {
      disposed = true;
      unlisten?.();
    },
  };
}
