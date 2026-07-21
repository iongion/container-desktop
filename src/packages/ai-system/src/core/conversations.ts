import type { z } from "zod";
import type { ChatSessionView, ChatTimelineItem } from "./chatEvents";
import { emptyChatSessionView } from "./chatReducer";
import { MAX_CONVERSATION_FILE_BYTES, MAX_RETAINED_CONVERSATIONS } from "./limits";
import { redactPayload } from "./redact";
import { conversationFileSchema, type conversationRecordSchema, type conversationSummarySchema } from "./schemas";

export const CONVERSATION_RECORD_VERSION = 1 as const;

// Single-sourced from the durable-record schema (which reuses chatView) — no hand-maintained twin.
export type ConversationRecordV1 = z.infer<typeof conversationRecordSchema>;

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export type CreateConversationRequest = Pick<ConversationRecordV1, "id" | "title" | "providerId" | "model">;

export interface ConversationStoreSnapshot {
  status: "missing" | "ok" | "error";
  records: ConversationRecordV1[];
  path: string;
}

export interface ConversationStore {
  load(): Promise<ConversationStoreSnapshot>;
  save(records: ConversationRecordV1[]): Promise<void>;
}

export interface ConversationFileV1 {
  version: typeof CONVERSATION_RECORD_VERSION;
  records: ConversationRecordV1[];
}

export type NewConversationRecord = CreateConversationRequest & { now: number };

export function createEmptyConversationRecord(input: NewConversationRecord): ConversationRecordV1 {
  return {
    version: CONVERSATION_RECORD_VERSION,
    id: input.id,
    title: input.title,
    createdAt: input.now,
    updatedAt: input.now,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.model ? { model: input.model } : {}),
    view: emptyChatSessionView(input.id),
    modelHistory: [],
  };
}

export function conversationSummary(record: ConversationRecordV1): ConversationSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.providerId ? { providerId: record.providerId } : {}),
    ...(record.model ? { model: record.model } : {}),
    phase: record.view.phase,
    lastSeq: record.view.lastSeq,
  };
}

export function normalizeRestoredConversation(record: ConversationRecordV1): ConversationRecordV1 {
  const interrupted =
    record.view.phase === "model" ||
    record.view.phase === "tool" ||
    record.view.phase === "interrupting" ||
    record.view.phase === "awaiting-approval" ||
    record.view.phase === "stopping";
  const view: ChatSessionView = interrupted
    ? {
        sessionId: record.id,
        phase: "idle",
        lastSeq: record.view.lastSeq,
        timeline: record.view.timeline.map((item, index): ChatTimelineItem => {
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

export function parseConversationFile(text: string): Pick<ConversationStoreSnapshot, "status" | "records"> {
  if (text.length > MAX_CONVERSATION_FILE_BYTES) return { status: "error", records: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "error", records: [] };
  }
  const result = conversationFileSchema.safeParse(parsed);
  if (!result.success) return { status: "error", records: [] };
  return { status: "ok", records: result.data.records.map(normalizeRestoredConversation) };
}

export function prepareConversationFile(records: ConversationRecordV1[]): ConversationFileV1 {
  const retained = [...records]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RETAINED_CONVERSATIONS)
    .map((record) => redactPayload(structuredClone(record)));
  const file = { version: CONVERSATION_RECORD_VERSION, records: retained } satisfies ConversationFileV1;
  if (!conversationFileSchema.safeParse(file).success) {
    throw new Error("AI: invalid or oversized conversation record");
  }
  if (JSON.stringify(file).length > MAX_CONVERSATION_FILE_BYTES) {
    throw new Error("AI: conversation store exceeds its size limit");
  }
  return file;
}
