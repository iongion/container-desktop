import type { ThreadSummary } from "@/ai-system/core/threads";

export interface ThreadRelativeAge {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
}

export type ThreadReferenceResolution =
  | { kind: "resolved"; thread: ThreadSummary }
  | { kind: "ambiguous" }
  | { kind: "not-found" };

export function threadRelativeAge(updatedAt: number, now = Date.now()): ThreadRelativeAge {
  const seconds = Math.floor(Math.max(0, now - updatedAt) / 1_000);
  if (seconds < 60) return { value: -seconds, unit: "second" };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { value: -minutes, unit: "minute" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: -hours, unit: "hour" };
  return { value: -Math.floor(hours / 24), unit: "day" };
}

export function selectThreadHistory(threads: readonly ThreadSummary[], query: string): ThreadSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return threads
    .filter((thread) => !needle || thread.title.toLocaleLowerCase().includes(needle))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

export function resolveThreadHistoryHighlight(
  threads: readonly ThreadSummary[],
  highlightedThreadId?: string,
  activeThreadId?: string | null,
): string | undefined {
  if (highlightedThreadId && threads.some(({ id }) => id === highlightedThreadId)) return highlightedThreadId;
  if (activeThreadId && threads.some(({ id }) => id === activeThreadId)) return activeThreadId;
  return threads[0]?.id;
}

export function moveThreadHistoryHighlight(
  threads: readonly ThreadSummary[],
  highlightedThreadId: string | undefined,
  delta: number,
): string | undefined {
  if (threads.length === 0) return undefined;
  const currentIndex = threads.findIndex(({ id }) => id === highlightedThreadId);
  if (currentIndex < 0) return threads[0].id;
  const nextIndex = (((currentIndex + delta) % threads.length) + threads.length) % threads.length;
  return threads[nextIndex].id;
}

export function resolveThreadReference(
  threads: readonly ThreadSummary[],
  reference: string,
): ThreadReferenceResolution {
  const normalized = reference.trim().toLocaleLowerCase();
  const byId = threads.find((thread) => thread.id.toLocaleLowerCase() === normalized);
  if (byId) return { kind: "resolved", thread: byId };

  const byTitle = threads.filter((thread) => thread.title.toLocaleLowerCase() === normalized);
  if (byTitle.length === 1) return { kind: "resolved", thread: byTitle[0] };
  return { kind: byTitle.length > 1 ? "ambiguous" : "not-found" };
}
