import { create } from "zustand";

import { systemNotifier } from "@/container-client/notifier";
import type { SystemNotification } from "@/env/Types";
import type {
  ActivityEntry,
  ActivityKind,
  ActivitySeverity,
  ActivityStatus,
  ApiEntry,
  CliBusPayload,
  CliEntry,
  NotificationEntry,
  SystemEntry,
} from "./activityTypes";

// Hard ceiling on retained entries — the stream is in-memory only and never persisted.
const CAP = 500;

export type ActivityTab = "notifications" | "activity";

export interface ActivityFilters {
  kinds: ActivityKind[]; // empty = all kinds
  severities: ActivitySeverity[]; // empty = all severities
}

interface ActivityState {
  entries: ActivityEntry[]; // newest-first
  lastSeenAt: number; // epoch ms of last drawer open — drives the unread badge
  drawerOpen: boolean;
  activeTab: ActivityTab;
  paused: boolean; // when true, api/cli entries are dropped (notifications/system still recorded)
  search: Record<ActivityTab, string>;
  filters: Record<ActivityTab, ActivityFilters>;

  // ingestion
  ingest: (entry: ActivityEntry) => void;
  upsert: (guid: string, patch: Partial<ActivityEntry>) => void;
  // controls
  clear: (tab?: ActivityTab) => void;
  togglePause: () => void;
  openDrawer: (tab?: ActivityTab) => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  markSeen: () => void;
  setActiveTab: (tab: ActivityTab) => void;
  setSearch: (tab: ActivityTab, term: string) => void;
  toggleKind: (tab: ActivityTab, kind: ActivityKind) => void;
  toggleSeverity: (tab: ActivityTab, severity: ActivitySeverity) => void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  entries: [],
  lastSeenAt: 0,
  drawerOpen: false,
  activeTab: "notifications",
  paused: false,
  search: { notifications: "", activity: "" },
  filters: {
    notifications: { kinds: [], severities: [] },
    activity: { kinds: [], severities: [] },
  },

  ingest: (entry) => {
    if (get().paused && (entry.kind === "api" || entry.kind === "cli")) {
      return;
    }
    set((state) => ({ entries: [entry, ...state.entries].slice(0, CAP) }));
  },

  upsert: (guid, patch) =>
    set((state) => {
      let found = false;
      const entries = state.entries.map((e) => {
        if (e.guid !== guid) {
          return e;
        }
        found = true;
        return { ...e, ...patch } as ActivityEntry;
      });
      return found ? { entries } : {};
    }),

  clear: (tab) =>
    set((state) => {
      if (!tab) {
        return { entries: [] };
      }
      // "notifications" tab clears notification entries; "activity" tab clears the rest.
      return {
        entries: state.entries.filter((e) =>
          tab === "notifications" ? e.kind !== "notification" : e.kind === "notification",
        ),
      };
    }),

  togglePause: () => set((state) => ({ paused: !state.paused })),

  openDrawer: (tab) =>
    set((state) => ({ drawerOpen: true, activeTab: tab ?? state.activeTab, lastSeenAt: Date.now() })),
  closeDrawer: () => set({ drawerOpen: false }),
  toggleDrawer: () =>
    set((state) => ({
      drawerOpen: !state.drawerOpen,
      lastSeenAt: state.drawerOpen ? state.lastSeenAt : Date.now(),
    })),
  markSeen: () => set({ lastSeenAt: Date.now() }),

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSearch: (tab, term) => set((state) => ({ search: { ...state.search, [tab]: term } })),
  toggleKind: (tab, kind) =>
    set((state) => {
      const current = state.filters[tab].kinds;
      const kinds = current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind];
      return { filters: { ...state.filters, [tab]: { ...state.filters[tab], kinds } } };
    }),
  toggleSeverity: (tab, severity) =>
    set((state) => {
      const current = state.filters[tab].severities;
      const severities = current.includes(severity) ? current.filter((s) => s !== severity) : [...current, severity];
      return { filters: { ...state.filters, [tab]: { ...state.filters[tab], severities } } };
    }),
}));

// Unread = entries newer than the last drawer open (capped to "99+" by the badge).
export function selectUnreadCount(state: ActivityState): number {
  let count = 0;
  for (const entry of state.entries) {
    if (entry.date > state.lastSeenAt) {
      count += 1;
    }
  }
  return count;
}

// ── Ingestion: system events (reused systemNotifier bus) ──────────────────────────────
// These run at module load — coexisting with the existing appStore listeners (eventemitter3
// supports multiple listeners per event). The drawer/header import this module, so the
// subscriptions are registered at app startup, not at component render.

function toSystemEntry(event: SystemNotification): SystemEntry {
  const trace = typeof event?.data?.trace === "string" ? event.data.trace : undefined;
  return {
    guid: event?.guid ?? crypto.randomUUID(),
    date: event?.date instanceof Date ? event.date.getTime() : Date.now(),
    kind: "system",
    severity: "info",
    title: trace ?? event?.type ?? "System event",
    eventType: event?.type ?? "system",
    data: event?.data,
  };
}

systemNotifier.on("startup.phase", (event: SystemNotification) => {
  useActivityStore.getState().ingest(toSystemEntry(event));
});
systemNotifier.on("engine.availability", (event: SystemNotification) => {
  useActivityStore.getState().ingest(toSystemEntry(event));
});

// ── Ingestion: user notifications (teed from Notification.show) ────────────────────────

export function intentToSeverity(intent: string | undefined): ActivitySeverity {
  switch (intent) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "danger":
      return "error";
    default:
      return "info"; // "primary" / "none"
  }
}

function toNotificationEntry(event: SystemNotification): NotificationEntry {
  const message = `${event?.data?.message ?? ""}`;
  const intent = typeof event?.data?.intent === "string" ? event.data.intent : "none";
  return {
    guid: event?.guid ?? crypto.randomUUID(),
    date: event?.date instanceof Date ? event.date.getTime() : Date.now(),
    kind: "notification",
    severity: intentToSeverity(intent),
    title: message,
    message,
    intent,
  };
}

systemNotifier.on("activity.notification", (event: SystemNotification) => {
  useActivityStore.getState().ingest(toNotificationEntry(event));
});

// ── Ingestion: engine API calls (from the Api.clients interceptor) ─────────────────────
// A "pending" event creates the entry; the matching "settled" event (same data.guid)
// patches in status/duration/bodies/curl so a single row updates in place.

function apiSeverity(status: ActivityStatus | undefined, httpStatus?: number): ActivitySeverity {
  if (status === "error") {
    return "error";
  }
  if (typeof httpStatus === "number") {
    if (httpStatus >= 500) {
      return "error";
    }
    if (httpStatus >= 400) {
      return "warning";
    }
  }
  return status === "pending" ? "info" : "success";
}

systemNotifier.on("activity.api", (event: SystemNotification) => {
  const data: any = event?.data ?? {};
  const store = useActivityStore.getState();
  if (data.phase === "pending") {
    const entry: ApiEntry = {
      guid: data.guid,
      date: event?.date instanceof Date ? event.date.getTime() : Date.now(),
      kind: "api",
      severity: "info",
      title: `${data.method} ${data.url}`,
      method: data.method,
      url: data.url,
      label: `${data.method} ${data.url}`,
      status: "pending",
    };
    store.ingest(entry);
    return;
  }
  store.upsert(data.guid, {
    status: data.status,
    severity: apiSeverity(data.status, data.httpStatus),
    httpStatus: data.httpStatus,
    durationMs: data.durationMs,
    requestBody: data.requestBody,
    curl: data.curl,
    error: data.error,
  } as Partial<ApiEntry>);
});

// ── Ingestion: CLI commands (from the preload ActivityBus over the contextBridge) ───────
// Subscribed lazily/idempotently — window.ActivityBus may not exist when this module first
// evaluates (preload race). NotificationCenterHost also calls this on mount; the preload
// buffers entries emitted before the first subscriber, so startup CLI calls are not lost.

let cliBusSubscribed = false;

function toCliEntry(payload: CliBusPayload): CliEntry {
  return {
    guid: payload.guid,
    date: payload.date ?? Date.now(),
    kind: "cli",
    severity: "info",
    title: payload.commandLine,
    launcher: payload.launcher,
    args: payload.args || [],
    invocation: payload.invocation,
    commandLine: payload.commandLine,
    status: "pending",
    background: payload.background,
  };
}

export function ensureCliBusSubscribed(): void {
  if (cliBusSubscribed || typeof window === "undefined" || !window.ActivityBus) {
    return;
  }
  cliBusSubscribed = true;
  window.ActivityBus.subscribe((payload: CliBusPayload) => {
    const store = useActivityStore.getState();
    if (payload.phase === "pending") {
      store.ingest(toCliEntry(payload));
      return;
    }
    store.upsert(payload.guid, {
      status: payload.status,
      severity: payload.status === "error" ? "error" : "success",
      exitCode: payload.exitCode,
      durationMs: payload.durationMs,
      stdoutPreview: payload.stdoutPreview,
      stderrPreview: payload.stderrPreview,
    } as Partial<CliEntry>);
  });
}

ensureCliBusSubscribed();
