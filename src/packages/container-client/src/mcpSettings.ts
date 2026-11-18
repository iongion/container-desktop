// The MCP server's settings, stored under `mcp` in user-settings.json. Off and read-only by default; a value that
// is missing or malformed falls back to its default, so a hand-edited file never opens the server wider than asked.
// The native side reads `mcp.port` itself for `--mcp-stdio` (src-tauri/src/mcp/settings.rs) with the same rules.

export const MCP_SETTINGS_KEY = "mcp";

// Below the Linux (32768+) and Windows (49152+) ephemeral ranges and Kubernetes' NodePorts (30000-32767), and clear
// of Vite (3000, 24678), Tauri's dev port (1420), LM Studio (1234), Ollama (11434), the Node inspector (9229), the MCP
// Inspector (6274, 6277), 9099 and the 4200/5173/8000/8080 family. Keep in step with DEFAULT_MCP_PORT in settings.rs.
export const DEFAULT_MCP_PORT = 17627;

const MIN_PORT = 1024;
const MAX_PORT = 65535;

// Mirrors McpPermissionMode in @/mcp-server/core/permissions without depending on it.
export type McpServerMode = "read-only" | "allow";

export interface McpSettings {
  enabled: boolean;
  port: number;
  mode: McpServerMode;
}

function normalizePort(value: unknown): number {
  const port =
    typeof value === "number" ? value : typeof value === "string" && /^\s*\d+\s*$/.test(value) ? +value : NaN;
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT ? port : DEFAULT_MCP_PORT;
}

export function normalizeMcpSettings(value: unknown): McpSettings {
  const stored = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  const { enabled, port, mode } = stored as Partial<Record<keyof McpSettings, unknown>>;
  return {
    enabled: enabled === true,
    port: normalizePort(port),
    mode: mode === "allow" ? "allow" : "read-only",
  };
}
