// Neutral Session events shared by the host Agent Session and renderer projection.
// No AI-SDK, React, Node, Tauri, or Wails imports.

import type { z } from "zod";
import type {
  resolveSessionApprovalRequest,
  resolveSessionApprovalResult,
  sessionEvent,
  sessionEventEnvelope,
  sessionPhase,
  sessionView,
  submitSessionRequest,
  submitSessionResult,
} from "./schemas";

export const MAX_AI_TEXT_CHARS = 32_000;
export const MAX_INITIAL_SESSION_HISTORY_MESSAGES = 500;
export const MAX_INITIAL_SESSION_HISTORY_CHARS = 1_000_000;
export const MAX_PENDING_INPUTS = 16;

export type SessionPhase = z.infer<typeof sessionPhase>;
export type SessionView = z.infer<typeof sessionView>;
export type SessionTimelineItem = SessionView["timeline"][number];
export type AssistantMessageStatus = Extract<SessionTimelineItem, { kind: "message" }>["status"];
export type UserMessageDelivery = Extract<SessionTimelineItem, { kind: "message" }>["delivery"];
export type SessionEvent = z.infer<typeof sessionEvent>;
export type SessionErrorScope = Extract<SessionEvent, { type: "error" }>["scope"];
export type SessionEventEnvelope = z.infer<typeof sessionEventEnvelope>;
export type SubmitSessionRequest = z.infer<typeof submitSessionRequest>;
export type SubmitSessionResult = z.infer<typeof submitSessionResult>;
export type ResolveSessionApprovalRequest = z.infer<typeof resolveSessionApprovalRequest>;
export type ResolveSessionApprovalResult = z.infer<typeof resolveSessionApprovalResult>;
