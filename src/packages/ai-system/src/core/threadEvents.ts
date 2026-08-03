// Neutral Thread events shared by the host Agent Session and renderer projection.
// No AI-SDK, React, Node, Tauri, or Wails imports.

import type { z } from "zod";
import type {
  resolveThreadApprovalRequest,
  resolveThreadApprovalResult,
  submitThreadRequest,
  submitThreadResult,
  threadEvent,
  threadEventEnvelope,
  threadPhase,
  threadView,
} from "./schemas";

export const MAX_AI_TEXT_CHARS = 32_000;
export const MAX_INITIAL_THREAD_HISTORY_MESSAGES = 500;
export const MAX_INITIAL_THREAD_HISTORY_CHARS = 1_000_000;
export const MAX_PENDING_INPUTS = 16;

export type ThreadPhase = z.infer<typeof threadPhase>;
export type ThreadView = z.infer<typeof threadView>;
export type ThreadTimelineItem = ThreadView["timeline"][number];
export type AssistantMessageStatus = Extract<ThreadTimelineItem, { kind: "message" }>["status"];
export type UserMessageDelivery = Extract<ThreadTimelineItem, { kind: "message" }>["delivery"];
export type ThreadEvent = z.infer<typeof threadEvent>;
export type ThreadErrorScope = Extract<ThreadEvent, { type: "error" }>["scope"];
export type ThreadEventEnvelope = z.infer<typeof threadEventEnvelope>;
export type SubmitThreadRequest = z.infer<typeof submitThreadRequest>;
export type SubmitThreadResult = z.infer<typeof submitThreadResult>;
export type ResolveThreadApprovalRequest = z.infer<typeof resolveThreadApprovalRequest>;
export type ResolveThreadApprovalResult = z.infer<typeof resolveThreadApprovalResult>;
