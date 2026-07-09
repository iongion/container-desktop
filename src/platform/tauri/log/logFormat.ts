// Pure formatter bridging the @/platform/logger façade's (scope, args[]) shape to plugin-log's single
// string message. Kept free of any @tauri-apps import so it stays hermetically unit-testable (the plugin-log
// binding lives in the sibling tauriLog.ts composition edge, verified by the build — the same split bridge.ts uses).

function stringifyArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  // Errors JSON.stringify to "{}" (message lost) — keep the stack/message so failures survive to the log file.
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value); // circular / non-serializable → best-effort, never throw
    }
  }
  return String(value);
}

// Mirror the façade's console line ("[scope] ...args") as one string for plugin-log.
export function formatLogArgs(scope: string, args: unknown[]): string {
  const body = args.map(stringifyArg).join(" ");
  return body ? `[${scope}] ${body}` : `[${scope}]`;
}
