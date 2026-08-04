// Maps a pi session onto the app's thread vocabulary. A pi session is a single conversation, so it
// surfaces as exactly one ThreadSummary; multi-session support arrives when the bridge exposes pi's
// session list. Kept pure so the derivation is tested without a store, a socket or a container.

import type { ThreadView } from "@/ai-system/core/threadEvents";
import type { ThreadSummary } from "@/ai-system/core/threads";

const MAX_TITLE = 120;

export interface PiSessionSummaryInput {
  view: ThreadView;
  modelId: string;
  startedAt: number;
}

function firstUserMessage(view: ThreadView): string | undefined {
  for (const item of view.timeline) {
    if (item.kind === "message" && item.role === "user" && item.content.trim()) return item.content.trim();
  }
  return undefined;
}

export function piSessionSummary(input: PiSessionSummaryInput): ThreadSummary {
  const opener = firstUserMessage(input.view);
  const title = opener ? (opener.length > MAX_TITLE ? `${opener.slice(0, MAX_TITLE - 1)}…` : opener) : input.modelId;
  return {
    id: input.view.threadId,
    title,
    titleOrigin: opener ? "message" : "default",
    createdAt: input.startedAt,
    updatedAt: input.startedAt,
    model: input.modelId,
    phase: input.view.phase,
    lastSeq: input.view.lastSeq,
  };
}
