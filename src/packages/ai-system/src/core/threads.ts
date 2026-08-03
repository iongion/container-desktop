import type { z } from "zod";
import { type AccessProfileId, DEFAULT_ACCESS_PROFILE } from "./accessProfiles";
import { MAX_RETAINED_THREADS, MAX_THREAD_FILE_BYTES } from "./limits";
import type { ReasoningLevel } from "./reasoning";
import { redactPayload } from "./redact";
import {
  type threadBranchPreviewSchema,
  type threadBranchResultSchema,
  type threadCheckpointSchema,
  type threadCompactionSchema,
  threadFileSchema,
  type threadLineageSchema,
  type threadRecordSchema,
  type threadSummarySchema,
} from "./schemas";
import type { ThreadTimelineItem, ThreadView } from "./threadEvents";
import { emptyThreadView } from "./threadReducer";

export const THREAD_RECORD_VERSION = 5 as const;

// Single-sourced from the durable-record schema (which reuses threadView) — no hand-maintained twin.
export type ThreadRecord = z.infer<typeof threadRecordSchema>;

export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export type ThreadCheckpoint = z.infer<typeof threadCheckpointSchema>;
export type ThreadCompaction = z.infer<typeof threadCompactionSchema>;
export type ThreadLineage = z.infer<typeof threadLineageSchema>;
export type ThreadBranchPreview = z.infer<typeof threadBranchPreviewSchema>;
export type ThreadBranchResult = z.infer<typeof threadBranchResultSchema>;

export type CreateThreadRequest = Pick<ThreadRecord, "id" | "title" | "providerId" | "model"> &
  Partial<Pick<ThreadRecord, "accessProfile" | "reasoningLevel">>;

export interface ThreadConfigurationPatch {
  accessProfile?: AccessProfileId;
  reasoningLevel?: ReasoningLevel;
}

export interface ThreadStoreSnapshot {
  status: "missing" | "ok" | "error";
  records: ThreadRecord[];
  path: string;
}

export interface ThreadStore {
  load(): Promise<ThreadStoreSnapshot>;
  save(records: ThreadRecord[]): Promise<void>;
}

export interface ThreadFile {
  version: typeof THREAD_RECORD_VERSION;
  records: ThreadRecord[];
}

export type NewThreadRecord = CreateThreadRequest & { now: number };

export interface BranchThreadRecordInput {
  id: string;
  checkpointId: string;
  parentCheckpointId: string;
  title: string;
  now: number;
  nextId: () => string;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function migrateLegacyThreadFile(value: unknown): unknown {
  const file = objectRecord(value);
  if (![1, 2, 3, 4].includes(Number(file?.version)) || !Array.isArray(file?.records)) return value;
  return {
    ...file,
    version: THREAD_RECORD_VERSION,
    records: file.records.map((entry) => {
      const record = objectRecord(entry);
      const view = objectRecord(record?.view);
      if (!record || !view) return entry;
      const { sessionId, ...legacyView } = view;
      return {
        ...record,
        version: THREAD_RECORD_VERSION,
        accessProfile:
          record.accessProfile === "observe" ||
          record.accessProfile === "workspace" ||
          record.accessProfile === "operator"
            ? record.accessProfile
            : DEFAULT_ACCESS_PROFILE,
        reasoningLevel: ["default", "low", "medium", "high"].includes(String(record.reasoningLevel))
          ? record.reasoningLevel
          : "default",
        checkpoints: Array.isArray(record.checkpoints) ? record.checkpoints : [],
        compactions: [],
        view: {
          ...legacyView,
          threadId: typeof view.threadId === "string" ? view.threadId : sessionId,
        },
      };
    }),
  };
}

export function createEmptyThreadRecord(input: NewThreadRecord): ThreadRecord {
  return {
    version: THREAD_RECORD_VERSION,
    id: input.id,
    title: input.title,
    titleOrigin: "default",
    createdAt: input.now,
    updatedAt: input.now,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.model ? { model: input.model } : {}),
    accessProfile: input.accessProfile ?? DEFAULT_ACCESS_PROFILE,
    reasoningLevel: input.reasoningLevel ?? "default",
    view: emptyThreadView(input.id),
    modelHistory: [],
    checkpoints: [],
    compactions: [],
  };
}

function isSettled(record: ThreadRecord): boolean {
  return !(
    record.view.phase !== "idle" ||
    record.view.activeTaskId ||
    record.view.activeSegmentId ||
    record.view.streamingAssistant ||
    record.view.timeline.some(
      (item) =>
        (item.kind === "tool" && item.status === "running") ||
        (item.kind === "approval" && (item.status === "pending" || item.status === "resolving")) ||
        (item.kind === "message" && item.role === "user" && item.delivery === "queued"),
    )
  );
}

function settledBoundaryMessage(record: ThreadRecord): Extract<ThreadTimelineItem, { kind: "message" }> | undefined {
  return record.view.timeline.findLast(
    (item): item is Extract<ThreadTimelineItem, { kind: "message" }> =>
      item.kind === "message" && item.delivery === "applied" && item.status !== "streaming",
  );
}

export function appendThreadCheckpoint(record: ThreadRecord, input: { id: string; now: number }): ThreadRecord {
  if (!isSettled(record)) throw new Error("AI: Thread must be settled at an applied message boundary");
  const boundary = settledBoundaryMessage(record);
  if (!boundary) return record;
  const timelineLength = record.view.timeline.length;
  const modelHistoryLength = record.modelHistory.length;
  const existing = record.checkpoints.at(-1);
  if (
    existing?.messageId === boundary.id &&
    existing.timelineLength === timelineLength &&
    existing.modelHistoryLength === modelHistoryLength
  ) {
    return record;
  }
  return {
    ...record,
    checkpoints: [
      ...record.checkpoints,
      { id: input.id, messageId: boundary.id, createdAt: input.now, timelineLength, modelHistoryLength },
    ],
  };
}

interface ProjectionIds {
  messages: Map<string, string>;
  toolCalls: Map<string, string>;
}

function mappedId(ids: Map<string, string>, source: string, nextId: () => string): string {
  const existing = ids.get(source);
  if (existing) return existing;
  const next = nextId();
  ids.set(source, next);
  return next;
}

function projectTimelineItem(
  item: ThreadTimelineItem,
  ids: ProjectionIds,
  nextId: () => string,
): ThreadTimelineItem | undefined {
  switch (item.kind) {
    case "message": {
      if (item.delivery !== "applied" || item.status === "streaming") return undefined;
      const id = mappedId(ids.messages, item.id, nextId);
      return { ...structuredClone(item), id };
    }
    case "tool": {
      if (item.status === "running") return undefined;
      const toolCallId = mappedId(ids.toolCalls, item.toolCallId, nextId);
      return { ...structuredClone(item), id: toolCallId, toolCallId };
    }
    case "approval": {
      if (item.status === "pending" || item.status === "resolving") return undefined;
      const toolCallId = mappedId(ids.toolCalls, item.toolCallId, nextId);
      const approvalId = nextId();
      return { ...structuredClone(item), id: approvalId, approvalId, toolCallId };
    }
    case "denied": {
      const toolCallId = mappedId(ids.toolCalls, item.toolCallId, nextId);
      return { ...structuredClone(item), id: toolCallId, toolCallId };
    }
    case "error":
      return { ...structuredClone(item), id: nextId() };
  }
}

function projectTimeline(
  source: ThreadRecord,
  checkpoint: ThreadCheckpoint,
  nextId: () => string,
): { timeline: ThreadTimelineItem[]; boundaryMessageId: string; messageIds: Map<string, string> } {
  const ids: ProjectionIds = { messages: new Map(), toolCalls: new Map() };
  const timeline = source.view.timeline.slice(0, checkpoint.timelineLength).flatMap((item) => {
    const projected = projectTimelineItem(item, ids, nextId);
    return projected ? [projected] : [];
  });
  const boundaryMessageId = ids.messages.get(checkpoint.messageId);
  if (!boundaryMessageId) throw new Error("AI: Thread checkpoint message boundary is unavailable");
  return { timeline, boundaryMessageId, messageIds: ids.messages };
}

export function branchThreadRecord(source: ThreadRecord, input: BranchThreadRecordInput): ThreadRecord {
  const parent = source.checkpoints.find((checkpoint) => checkpoint.id === input.parentCheckpointId);
  if (!parent) throw new Error("AI: Thread checkpoint not found");
  const { timeline, boundaryMessageId, messageIds } = projectTimeline(source, parent, input.nextId);
  const compactionIds = new Map<string, string>();
  const compactions = source.compactions
    .filter((compaction) => compaction.source.historyEnd <= parent.modelHistoryLength)
    .flatMap((compaction) => {
      const messageStartId = messageIds.get(compaction.source.messageStartId);
      const messageEndId = messageIds.get(compaction.source.messageEndId);
      if (!messageStartId || !messageEndId) return [];
      const id = input.nextId();
      compactionIds.set(compaction.id, id);
      return [{ ...structuredClone(compaction), id, source: { ...compaction.source, messageStartId, messageEndId } }];
    });
  const activeCompactionId = source.activeCompactionId ? compactionIds.get(source.activeCompactionId) : undefined;
  return {
    version: THREAD_RECORD_VERSION,
    id: input.id,
    title: input.title,
    titleOrigin: "user",
    createdAt: input.now,
    updatedAt: input.now,
    ...(source.providerId ? { providerId: source.providerId } : {}),
    ...(source.model ? { model: source.model } : {}),
    accessProfile: source.accessProfile,
    reasoningLevel: source.reasoningLevel,
    lineage: { parentThreadId: source.id, parentCheckpointId: parent.id },
    view: { threadId: input.id, phase: "idle", lastSeq: 0, timeline },
    modelHistory: structuredClone(source.modelHistory.slice(0, parent.modelHistoryLength)),
    checkpoints: [
      {
        id: input.checkpointId,
        messageId: boundaryMessageId,
        createdAt: input.now,
        timelineLength: timeline.length,
        modelHistoryLength: parent.modelHistoryLength,
      },
    ],
    compactions,
    ...(activeCompactionId ? { activeCompactionId } : {}),
  };
}

export function threadSummary(record: ThreadRecord): ThreadSummary {
  return {
    id: record.id,
    title: record.title,
    ...(record.titleOrigin ? { titleOrigin: record.titleOrigin } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.providerId ? { providerId: record.providerId } : {}),
    ...(record.model ? { model: record.model } : {}),
    accessProfile: record.accessProfile,
    reasoningLevel: record.reasoningLevel,
    phase: record.view.phase,
    lastSeq: record.view.lastSeq,
  };
}

export function normalizeRestoredThread(record: ThreadRecord): ThreadRecord {
  const interrupted =
    record.view.phase === "model" ||
    record.view.phase === "tool" ||
    record.view.phase === "interrupting" ||
    record.view.phase === "awaiting-approval" ||
    record.view.phase === "stopping";
  const view: ThreadView = interrupted
    ? {
        threadId: record.id,
        phase: "idle",
        lastSeq: record.view.lastSeq,
        timeline: record.view.timeline.map((item, index): ThreadTimelineItem => {
          if (item.kind === "message" && item.status === "streaming") {
            const streaming = record.view.streamingAssistant;
            return {
              ...item,
              content:
                streaming?.id === item.id && streaming.timelineIndex === index ? streaming.content : item.content,
              status: "stopped",
            };
          }
          if (item.kind === "tool" && item.status === "running") return { ...item, status: "error", ok: false };
          if (item.kind === "approval" && (item.status === "pending" || item.status === "resolving")) {
            return { ...item, status: "rejected" };
          }
          return item;
        }),
      }
    : structuredClone(record.view);
  return redactPayload({ ...structuredClone(record), view });
}

export function parseThreadFile(text: string): Pick<ThreadStoreSnapshot, "status" | "records"> {
  if (text.length > MAX_THREAD_FILE_BYTES) return { status: "error", records: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "error", records: [] };
  }
  const result = threadFileSchema.safeParse(migrateLegacyThreadFile(parsed));
  if (!result.success) return { status: "error", records: [] };
  return { status: "ok", records: result.data.records.map(normalizeRestoredThread) };
}

export function prepareThreadFile(records: ThreadRecord[]): ThreadFile {
  const retained = [...records]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RETAINED_THREADS)
    .map((record) => redactPayload(structuredClone(record)));
  const file = { version: THREAD_RECORD_VERSION, records: retained } satisfies ThreadFile;
  const parsed = threadFileSchema.safeParse(file);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`AI: invalid thread record (${issue.path.join(".") || "root"}: ${issue.message})`);
  }
  if (JSON.stringify(file).length > MAX_THREAD_FILE_BYTES) {
    throw new Error("AI: thread store exceeds its size limit");
  }
  return file;
}
