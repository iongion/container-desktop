import type { AssistantCommandCapabilityId } from "@/ai-system/ui/core/commands/commandTypes";
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

// Thread capabilities the app's UI offers that the bridge does not carry yet. Rejecting by name beats
// silently doing nothing: the drawer surfaces a real message instead of appearing to hang.
// A pi session is ONE conversation: no thread list, no history rewriting, and its model and access are fixed
// when the container pair starts. It CAN start a fresh conversation — by starting a fresh session. The command palette reads this so an unsupported command is refused with a
// reason instead of being offered, accepted, and rejected from inside the store.
export const PI_SESSION_CAPABILITIES: ReadonlySet<AssistantCommandCapabilityId> = new Set(["conversation-reset"]);

export function piSessionUnavailable(capability: string): Error {
  return new Error(`AI: ${capability} is not available on the pi session yet`);
}
