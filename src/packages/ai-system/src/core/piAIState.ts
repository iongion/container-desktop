// Maps a pi session onto the app's session vocabulary. A pi session is a single conversation, so it
// surfaces as exactly one SessionSummary; multi-session support arrives when the bridge exposes pi's
// session list. Kept pure so the derivation is tested without a store, a socket or a container.

import type { SessionView } from "@/ai-system/core/sessionEvents";
import type { SessionSummary } from "@/ai-system/core/sessions";

const MAX_TITLE = 120;

export interface PiSessionSummaryInput {
  view: SessionView;
  modelId: string;
  startedAt: number;
}

function firstUserMessage(view: SessionView): string | undefined {
  for (const item of view.timeline) {
    if (item.kind === "message" && item.role === "user" && item.content.trim()) return item.content.trim();
  }
  return undefined;
}

export function piSessionSummary(input: PiSessionSummaryInput): SessionSummary {
  const opener = firstUserMessage(input.view);
  const title = opener ? (opener.length > MAX_TITLE ? `${opener.slice(0, MAX_TITLE - 1)}…` : opener) : input.modelId;
  return {
    id: input.view.sessionId,
    title,
    titleOrigin: opener ? "message" : "default",
    createdAt: input.startedAt,
    updatedAt: input.startedAt,
    model: input.modelId,
    phase: input.view.phase,
    lastSeq: input.view.lastSeq,
  };
}
