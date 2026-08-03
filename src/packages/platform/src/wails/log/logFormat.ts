// Pure formatter bridging the @/logger façade's (scope, args[]) shape to a single string
// message. Identical to src/platform/tauri/log/logFormat.ts — kept import-free so it stays
// hermetically unit-testable (the sink binding lives in the sibling wailsLog.ts composition edge).

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

// Mirror the façade's console line ("[scope] ...args") as one string for the native sink.
export function formatLogArgs(scope: string, args: unknown[]): string {
  const body = args.map(stringifyArg).join(" ");
  return body ? `[${scope}] ${body}` : `[${scope}]`;
}
