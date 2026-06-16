// Unified entry model for the Notification Center + Activity Log.
//
// One in-memory, capped, NON-persisted stream feeds both drawer tabs:
//   - "notifications" tab → kind === "notification"
//   - "activity" tab      → kind ∈ {"api","cli","system"}
//
// Everything is normalized to primitives (date is epoch ms, never a Date) so that
// CLI entries arriving over the contextBridge stay structured-cloneable and the whole
// list sorts cheaply by `date`.

export type ActivityKind = "notification" | "api" | "cli" | "system";
export type ActivitySeverity = "info" | "success" | "warning" | "error";
export type ActivityStatus = "pending" | "ok" | "error";

export const ACTIVITY_KINDS: ActivityKind[] = ["notification", "api", "cli", "system"];
export const ACTIVITY_SEVERITIES: ActivitySeverity[] = ["info", "success", "warning", "error"];

// Kinds that belong to the "activity" tab (everything that is not a user notification).
export const ACTIVITY_TAB_KINDS: ActivityKind[] = ["api", "cli", "system"];

export interface ActivityEntryBase {
  guid: string;
  date: number; // epoch ms
  kind: ActivityKind;
  severity: ActivitySeverity;
  title: string;
}

export interface NotificationEntry extends ActivityEntryBase {
  kind: "notification";
  message: string;
  intent: string; // Blueprint Intent ("success" | "primary" | "warning" | "danger" | "none")
}

export interface ApiEntry extends ActivityEntryBase {
  kind: "api";
  method: string; // HTTP method
  url: string; // path incl. query
  label: string; // friendly label, e.g. "List containers"
  status: ActivityStatus;
  httpStatus?: number;
  durationMs?: number;
  curl?: string;
  requestBody?: string; // JSON-stringified, truncated
  responseBody?: string; // JSON-stringified, truncated — captured only for non-2xx responses
  error?: string;
}

export interface CliEntry extends ActivityEntryBase {
  kind: "cli";
  launcher: string;
  args: string[];
  invocation: "Execute" | "Spawn" | "ExecuteAsBackgroundService";
  status: ActivityStatus;
  exitCode?: number | null;
  durationMs?: number;
  commandLine: string;
  stdoutPreview?: string;
  stderrPreview?: string;
  background?: boolean;
}

export interface SystemEntry extends ActivityEntryBase {
  kind: "system";
  eventType: string; // systemNotifier event type, e.g. "startup.phase"
  data?: any;
}

export type ActivityEntry = NotificationEntry | ApiEntry | CliEntry | SystemEntry;

// Plain payload pushed across the contextBridge by the preload CLI wrapper. Kept loose and
// self-contained (no imports) so the preload bundle never pulls in web-app code; the store
// normalizes it into a CliEntry. Two phases share one `guid`: "pending" then "settled".
export interface CliBusPayload {
  guid: string;
  date: number;
  phase: "pending" | "settled";
  invocation: "Execute" | "Spawn" | "ExecuteAsBackgroundService";
  launcher: string;
  args: string[];
  commandLine: string;
  status?: ActivityStatus;
  exitCode?: number | null;
  durationMs?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
  background?: boolean;
}
