// Neutral chat-session events shared by the host session actor and renderer projection.
// No AI-SDK, Electron, React, Node, Tauri, or Wails imports.

import type { z } from "zod";
import type {
  chatEvent,
  chatEventEnvelope,
  chatPhase,
  chatView,
  resolveChatApprovalRequest,
  resolveChatApprovalResult,
  submitChatRequest,
  submitChatResult,
} from "./schemas";

export const MAX_CHAT_MESSAGE_CHARS = 32_000;
export const MAX_INITIAL_HISTORY_MESSAGES = 500;
export const MAX_INITIAL_HISTORY_CHARS = 1_000_000;
export const MAX_PENDING_INPUTS = 16;

export type ChatPhase = z.infer<typeof chatPhase>;
export type ChatSessionView = z.infer<typeof chatView>;
export type ChatTimelineItem = ChatSessionView["timeline"][number];
export type AssistantMessageStatus = Extract<ChatTimelineItem, { kind: "message" }>["status"];
export type UserMessageDelivery = Extract<ChatTimelineItem, { kind: "message" }>["delivery"];
export type ChatEvent = z.infer<typeof chatEvent>;
export type ChatErrorScope = Extract<ChatEvent, { type: "error" }>["scope"];
export type ChatEventEnvelope = z.infer<typeof chatEventEnvelope>;
export type SubmitChatRequest = z.infer<typeof submitChatRequest>;
export type SubmitChatResult = z.infer<typeof submitChatResult>;
export type ResolveChatApprovalRequest = z.infer<typeof resolveChatApprovalRequest>;
export type ResolveChatApprovalResult = z.infer<typeof resolveChatApprovalResult>;
