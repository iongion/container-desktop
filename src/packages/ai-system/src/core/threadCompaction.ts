import type { ContextTrust } from "./context";
import {
  MAX_THREAD_COMPACTION_INSTRUCTIONS_CHARS,
  MAX_THREAD_COMPACTION_SUMMARY_CHARS,
  MAX_THREAD_COMPACTIONS,
} from "./limits";
import type { ThreadView } from "./threadEvents";
import type { ThreadCompaction, ThreadRecord, ThreadSummary } from "./threads";

export const THREAD_COMPACTION_RETAIN_RECENT_MESSAGES = 8;
export const THREAD_COMPACTION_MINIMUM_SOURCE_MESSAGES = 8;

export interface ThreadCompactionRevision {
  lastSeq: number;
  modelHistoryLength: number;
  activeCompactionId?: string;
}

export interface ThreadCompactionPlan {
  source: ThreadCompaction["source"];
  sourceHistoryMessages: number;
  retainedHistoryMessages: number;
  replacesCompactionId?: string;
  revision: ThreadCompactionRevision;
}

export interface ThreadCompactionPreview {
  thread: ThreadSummary;
  plan: ThreadCompactionPlan;
  providerId: string;
  model?: string;
  active?: ThreadCompaction;
}

export interface ThreadCompactionExecutionResult {
  thread: ThreadSummary;
  view: ThreadView;
  compaction: ThreadCompaction;
}

export interface PlanThreadCompactionOptions {
  retainRecentMessages: number;
  minimumSourceMessages: number;
}

export type ApplyThreadCompactionInput = Omit<ThreadCompaction, "source" | "contentTrust" | "tainted"> & {
  plan: ThreadCompactionPlan;
};

const TRUST_RANK: Record<ContextTrust, number> = { application: 0, user: 1, project: 2, external: 3 };

function currentRevision(record: ThreadRecord): ThreadCompactionRevision {
  return {
    lastSeq: record.view.lastSeq,
    modelHistoryLength: record.modelHistory.length,
    ...(record.activeCompactionId ? { activeCompactionId: record.activeCompactionId } : {}),
  };
}

function sameRevision(left: ThreadCompactionRevision, right: ThreadCompactionRevision): boolean {
  return (
    left.lastSeq === right.lastSeq &&
    left.modelHistoryLength === right.modelHistoryLength &&
    left.activeCompactionId === right.activeCompactionId
  );
}

function strongestContentTrust(record: ThreadRecord): ContextTrust {
  return (record.view.context?.sources ?? []).reduce<ContextTrust>(
    (strongest, source) => (TRUST_RANK[source.trust] > TRUST_RANK[strongest] ? source.trust : strongest),
    "application",
  );
}

export function planThreadCompaction(
  record: ThreadRecord,
  options: PlanThreadCompactionOptions,
): ThreadCompactionPlan | undefined {
  const maximumSourceEnd = record.modelHistory.length - Math.max(0, options.retainRecentMessages);
  const active = record.compactions.find(({ id }) => id === record.activeCompactionId);
  const activeSourceEnd = active?.source.historyEnd ?? 0;
  const checkpoint = record.checkpoints.findLast(
    (candidate) =>
      candidate.modelHistoryLength <= maximumSourceEnd &&
      candidate.modelHistoryLength >= options.minimumSourceMessages &&
      candidate.modelHistoryLength > activeSourceEnd,
  );
  const firstMessage = record.view.timeline.find((item) => item.kind === "message" && item.delivery === "applied");
  if (!checkpoint || firstMessage?.kind !== "message") return undefined;
  return {
    source: {
      historyStart: 0,
      historyEnd: checkpoint.modelHistoryLength,
      messageStartId: firstMessage.id,
      messageEndId: checkpoint.messageId,
    },
    sourceHistoryMessages: checkpoint.modelHistoryLength,
    retainedHistoryMessages: record.modelHistory.length - checkpoint.modelHistoryLength,
    ...(active ? { replacesCompactionId: active.id } : {}),
    revision: currentRevision(record),
  };
}

export function activeThreadContext(record: ThreadRecord): {
  summary?: ThreadCompaction;
  history: unknown[];
  omittedMessages: number;
} {
  const summary = record.compactions.find(({ id }) => id === record.activeCompactionId);
  if (!summary) return { history: structuredClone(record.modelHistory), omittedMessages: 0 };
  return {
    summary: structuredClone(summary),
    history: structuredClone(record.modelHistory.slice(summary.source.historyEnd)),
    omittedMessages: summary.source.historyEnd,
  };
}

export function applyThreadCompaction(record: ThreadRecord, input: ApplyThreadCompactionInput): ThreadRecord {
  if (!sameRevision(currentRevision(record), input.plan.revision)) throw new Error("AI: Thread changed after preview");
  const checkpoint = record.checkpoints.find(
    ({ messageId, modelHistoryLength }) =>
      messageId === input.plan.source.messageEndId && modelHistoryLength === input.plan.source.historyEnd,
  );
  if (!checkpoint || input.plan.source.historyEnd > record.modelHistory.length) {
    throw new Error("AI: Thread compaction source is unavailable");
  }
  const summary = input.summary.trim();
  const instructions = input.instructions?.trim();
  if (!summary || summary.length > MAX_THREAD_COMPACTION_SUMMARY_CHARS) {
    throw new Error("AI: Thread compaction summary is invalid");
  }
  if (instructions && instructions.length > MAX_THREAD_COMPACTION_INSTRUCTIONS_CHARS) {
    throw new Error("AI: Thread compaction instructions are too large");
  }
  const contentTrust = strongestContentTrust(record);
  const compaction: ThreadCompaction = {
    id: input.id,
    createdAt: input.createdAt,
    source: structuredClone(input.plan.source),
    summary,
    ...(instructions ? { instructions } : {}),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.model ? { model: input.model } : {}),
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    fingerprint: input.fingerprint,
    contentTrust,
    tainted: contentTrust === "project" || contentTrust === "external",
  };
  return {
    ...record,
    updatedAt: input.createdAt,
    compactions: [...record.compactions, compaction].slice(-MAX_THREAD_COMPACTIONS),
    activeCompactionId: compaction.id,
  };
}
