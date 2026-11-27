import type { McpSettings } from "@/container-client/mcpSettings";
import { MCP_CHANNELS, type McpStatus } from "@/platform/mcpIpc";

// What the MCP server panel reaches: the controller's channels, and where its settings are kept.
export interface McpServerDeps {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  saveSettings: (settings: McpSettings) => Promise<unknown>;
}

export interface McpServerView {
  status: McpStatus;
  // Empty while the server is off, or when the keychain would not hand it over.
  token: string;
}

// The token is read only while the server runs: asking for it creates one, and a server that is off needs none.
async function viewOf(status: McpStatus, deps: McpServerDeps): Promise<McpServerView> {
  if (!status.running) return { status, token: "" };
  const token = await deps.invoke(MCP_CHANNELS.token).then(
    (value) => (typeof value === "string" ? value : ""),
    () => "",
  );
  return { status, token };
}

export async function loadMcpServer(deps: McpServerDeps): Promise<McpServerView> {
  return viewOf((await deps.invoke(MCP_CHANNELS.status)) as McpStatus, deps);
}

// Saved first, so the next boot and `--mcp-stdio` read the very settings applied here.
export async function applyMcpSettings(settings: McpSettings, deps: McpServerDeps): Promise<McpServerView> {
  await deps.saveSettings(settings);
  return viewOf((await deps.invoke(MCP_CHANNELS.apply, { settings })) as McpStatus, deps);
}
