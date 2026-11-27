// core (shell-neutral): the MCP server's controller contract and its IPC registrar. Mirrors registerLoggingIpc: the
// transport (`onInvoke`) and the controller are injected, so a shell supplies its own behind the SAME channels, and
// the renderer reaches the controller with `MessageBus.invoke(MCP_CHANNELS.<name>, payload)`.

import { type McpServerMode, type McpSettings, normalizeMcpSettings } from "@/container-client/mcpSettings";

export const MCP_CHANNELS = {
  apply: "mcp:apply",
  status: "mcp:status",
  token: "mcp:token",
  regenerateToken: "mcp:regenerate-token",
} as const;

export interface McpStatus {
  running: boolean;
  port?: number;
  // Where clients connect, e.g. http://127.0.0.1:17627/mcp.
  url?: string;
  mode?: McpServerMode;
  // Why the server is not running: a port in use, a token the OS keychain could not store.
  error?: string;
}

export interface McpTokenOptions {
  // The user's explicit consent to keep the token outside an unavailable OS keychain.
  allowDegraded?: boolean;
}

export interface McpController {
  // Start, restart (a new port) or stop the listener to match `settings`, or the saved settings when omitted.
  // Never rejects: a failure comes back in `status.error`.
  apply(settings?: McpSettings, options?: McpTokenOptions): Promise<McpStatus>;
  status(): Promise<McpStatus>;
  // The token, created first when there is none yet.
  token(options?: McpTokenOptions): Promise<string>;
  // A new token; a running listener restarts so the old one stops working at once.
  regenerateToken(options?: McpTokenOptions): Promise<string>;
  dispose(): void;
}

export interface McpApplyPayload extends McpTokenOptions {
  // Raw settings, normalized here; omitted means the saved ones.
  settings?: unknown;
}

export interface McpIpcDeps {
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  // Gate every handler to the main app window only.
  isAllowedSender: (event: any) => boolean;
  controller: McpController;
}

const DENIED = "Denied: only the app window controls the MCP server";

function tokenOptions(payload: unknown): McpTokenOptions {
  return { allowDegraded: (payload as McpTokenOptions | undefined)?.allowDegraded === true };
}

export function registerMcpIpc({ onInvoke, isAllowedSender, controller }: McpIpcDeps): void {
  onInvoke(MCP_CHANNELS.apply, (event, payload?: McpApplyPayload) => {
    if (!isAllowedSender(event)) return { running: false, error: DENIED };
    const settings = payload?.settings === undefined ? undefined : normalizeMcpSettings(payload.settings);
    return controller.apply(settings, tokenOptions(payload));
  });
  onInvoke(MCP_CHANNELS.status, (event) => {
    if (!isAllowedSender(event)) return { running: false, error: DENIED };
    return controller.status();
  });
  onInvoke(MCP_CHANNELS.token, (event, payload) => {
    if (!isAllowedSender(event)) return Promise.reject(new Error(DENIED));
    return controller.token(tokenOptions(payload));
  });
  onInvoke(MCP_CHANNELS.regenerateToken, (event, payload) => {
    if (!isAllowedSender(event)) return Promise.reject(new Error(DENIED));
    return controller.regenerateToken(tokenOptions(payload));
  });
}
