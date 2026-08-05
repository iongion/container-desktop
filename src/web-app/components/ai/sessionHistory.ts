import type { SessionSummary } from "@/ai-system/core/sessions";

export interface SessionRelativeAge {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
}

export type SessionReferenceResolution =
  | { kind: "resolved"; session: SessionSummary }
  | { kind: "ambiguous" }
  | { kind: "not-found" };

export function sessionRelativeAge(updatedAt: number, now = Date.now()): SessionRelativeAge {
  const seconds = Math.floor(Math.max(0, now - updatedAt) / 1_000);
  if (seconds < 60) return { value: -seconds, unit: "second" };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { value: -minutes, unit: "minute" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: -hours, unit: "hour" };
  return { value: -Math.floor(hours / 24), unit: "day" };
}

export function selectSessionHistory(sessions: readonly SessionSummary[], query: string): SessionSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return sessions
    .filter((session) => !needle || session.title.toLocaleLowerCase().includes(needle))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

export function resolveSessionHistoryHighlight(
  sessions: readonly SessionSummary[],
  highlightedSessionId?: string,
  activeSessionId?: string | null,
): string | undefined {
  if (highlightedSessionId && sessions.some(({ id }) => id === highlightedSessionId)) return highlightedSessionId;
  if (activeSessionId && sessions.some(({ id }) => id === activeSessionId)) return activeSessionId;
  return sessions[0]?.id;
}

export function moveSessionHistoryHighlight(
  sessions: readonly SessionSummary[],
  highlightedSessionId: string | undefined,
  delta: number,
): string | undefined {
  if (sessions.length === 0) return undefined;
  const currentIndex = sessions.findIndex(({ id }) => id === highlightedSessionId);
  if (currentIndex < 0) return sessions[0].id;
  const nextIndex = (((currentIndex + delta) % sessions.length) + sessions.length) % sessions.length;
  return sessions[nextIndex].id;
}

export function resolveSessionReference(
  sessions: readonly SessionSummary[],
  reference: string,
): SessionReferenceResolution {
  const normalized = reference.trim().toLocaleLowerCase();
  const byId = sessions.find((session) => session.id.toLocaleLowerCase() === normalized);
  if (byId) return { kind: "resolved", session: byId };

  const byTitle = sessions.filter((session) => session.title.toLocaleLowerCase() === normalized);
  if (byTitle.length === 1) return { kind: "resolved", session: byTitle[0] };
  return { kind: byTitle.length > 1 ? "ambiguous" : "not-found" };
}
