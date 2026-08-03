import type { ThreadEventEnvelope, ThreadView } from "@/ai-system/core/threadEvents";
import { reduceThreadEvent } from "@/ai-system/core/threadReducer";
import type { ThreadSummary } from "@/ai-system/core/threads";
import type { AIStoreDeps, RequestMeta, ThreadClientState } from "./threadClientReducer";

export const MAX_SNAPSHOT_FAILURES = 3;
const MAX_RECOVERY_BUFFER = 256;

export function withApprovalStatus(view: ThreadView, approvalId: string, status: "pending" | "resolving"): ThreadView {
  return {
    ...view,
    timeline: view.timeline.map((item) =>
      item.kind === "approval" && item.approvalId === approvalId ? { ...item, status } : item,
    ),
  };
}

export function bufferEnvelope(
  buffer: ThreadEventEnvelope[],
  envelope: ThreadEventEnvelope,
  log: { error: (...args: unknown[]) => void },
): { events: ThreadEventEnvelope[]; overflowed: boolean } {
  if (buffer.some((entry) => entry.seq === envelope.seq)) return { events: buffer, overflowed: false };
  const next = [...buffer, envelope].sort((a, b) => a.seq - b.seq);
  if (next.length > MAX_RECOVERY_BUFFER) {
    log.error("Thread recovery buffer overflow", {
      threadId: envelope.threadId,
      dropped: next.length - MAX_RECOVERY_BUFFER,
    });
    return { events: next.slice(next.length - MAX_RECOVERY_BUFFER), overflowed: true };
  }
  return { events: next, overflowed: false };
}

export function drainBuffer(
  view: ThreadView,
  buffer: ThreadEventEnvelope[],
): { view: ThreadView; remaining: ThreadEventEnvelope[]; needsSnapshot: boolean } {
  let current = view;
  let remaining = buffer.filter((entry) => entry.seq > current.lastSeq);
  for (;;) {
    const index = remaining.findIndex((entry) => entry.seq === current.lastSeq + 1);
    if (index === -1) break;
    current = reduceThreadEvent(current, remaining[index]).view;
    remaining = remaining.filter((_, position) => position !== index);
  }
  return { view: current, remaining, needsSnapshot: remaining.length > 0 };
}

export function threadEpoch(state: ThreadClientState, threadId: string): number {
  return state.threadEpochs[threadId] ?? 0;
}

export function mostRecentThreadId(threads: ThreadSummary[]): string | null {
  return (
    threads.reduce<ThreadSummary | undefined>(
      (latest, thread) => (!latest || thread.updatedAt > latest.updatedAt ? thread : latest),
      undefined,
    )?.id ?? null
  );
}

export function withoutRequest(state: ThreadClientState, requestId: string): Record<string, RequestMeta> {
  const requests = { ...state.requests };
  delete requests[requestId];
  return requests;
}

export function rememberSelection(deps: AIStoreDeps, threadId: string | null): void {
  try {
    deps.saveSelectedThreadId?.(threadId);
  } catch (error) {
    deps.log.error("Thread selection persistence failed", error);
  }
}

export function restoredSelection(deps: AIStoreDeps): string | null {
  try {
    return deps.loadSelectedThreadId?.() ?? null;
  } catch (error) {
    deps.log.error("Thread selection restore failed", error);
    return null;
  }
}
