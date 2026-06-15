// Pure helpers for the Notification Center — no React, no store imports, so they are
// trivially unit-testable. Entries arrive newest-first from the store, so filtering
// preserves order (no re-sort needed).

import type { ActivityEntry, ActivityKind, ActivitySeverity } from "@/web-app/stores/activityTypes";
import { friendlyEndpoint } from "./endpointLabels";

export interface FilterOptions {
  tabKinds: ActivityKind[]; // the kinds this tab is allowed to show
  kinds: ActivityKind[]; // chip filter within the tab (empty = all tabKinds)
  severities: ActivitySeverity[]; // empty = all severities
  search: string;
}

// Free-text haystack per entry kind (lowercased by the caller). API entries also match on
// their friendly label ("list containers") so search works on human terms.
export function entryHaystack(entry: ActivityEntry): string {
  switch (entry.kind) {
    case "api":
      return `${entry.method} ${entry.url} ${friendlyEndpoint(entry.method, entry.url) ?? ""}`;
    case "cli":
      return `${entry.commandLine} ${entry.title}`;
    case "notification":
      return entry.message;
    default:
      return `${entry.eventType} ${entry.title}`;
  }
}

export function filterEntries(entries: ActivityEntry[], opts: FilterOptions): ActivityEntry[] {
  const query = opts.search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (!opts.tabKinds.includes(entry.kind)) {
      return false;
    }
    if (opts.kinds.length > 0 && !opts.kinds.includes(entry.kind)) {
      return false;
    }
    if (opts.severities.length > 0 && !opts.severities.includes(entry.severity)) {
      return false;
    }
    if (query.length > 0 && !entryHaystack(entry).toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });
}

// Compact relative timestamp: "now", "12s", "5m", "3h", "2d".
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const seconds = Math.floor(Math.max(0, now - ts) / 1000);
  if (seconds < 5) {
    return "now";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

export interface CollapsedEntry {
  entry: ActivityEntry; // representative (the most recent of the run, since newest-first)
  count: number;
}

function isSameRepeat(a: ActivityEntry, b: ActivityEntry): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "api" && b.kind === "api") {
    return a.method === b.method && a.url === b.url && a.httpStatus === b.httpStatus;
  }
  if (a.kind === "cli" && b.kind === "cli") {
    return a.commandLine === b.commandLine && a.exitCode === b.exitCode;
  }
  if (a.kind === "system" && b.kind === "system") {
    return a.title === b.title;
  }
  return false;
}

// Fold runs of adjacent identical entries (e.g. repeated polls) into one row with a count,
// so the activity stream stays readable. Operates on the already newest-first list.
export function collapseConsecutiveDuplicates(entries: ActivityEntry[]): CollapsedEntry[] {
  const out: CollapsedEntry[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (last && isSameRepeat(last.entry, entry)) {
      last.count += 1;
    } else {
      out.push({ entry, count: 1 });
    }
  }
  return out;
}
