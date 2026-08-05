import { z } from "zod";
import { MAX_SESSION_TIMELINE_ITEMS } from "./limits";
import { redactPayload } from "./redact";
import { MAX_AI_TEXT_CHARS, type SessionTimelineItem, type SessionView } from "./sessionEvents";
import type { SessionSummary } from "./sessions";

export const SESSION_EXPORT_VERSION = 1 as const;

const exportMessage = z
  .object({
    kind: z.literal("message"),
    role: z.enum(["user", "assistant"]),
    content: z.string().max(MAX_AI_TEXT_CHARS),
    delivery: z.enum(["queued", "applied", "discarded"]),
    status: z.enum(["streaming", "complete", "interrupted", "stopped", "error"]),
  })
  .strict();
const exportTool = z
  .object({
    kind: z.literal("tool"),
    tool: z.string(),
    title: z.string(),
    args: z.record(z.string(), z.unknown()),
    status: z.enum(["running", "complete", "error"]),
    ok: z.boolean().optional(),
    result: z.unknown().optional(),
    message: z.string().max(MAX_AI_TEXT_CHARS).optional(),
  })
  .strict();
const exportApproval = z
  .object({
    kind: z.literal("approval"),
    tool: z.string(),
    title: z.string(),
    args: z.record(z.string(), z.unknown()),
    reason: z.string().max(MAX_AI_TEXT_CHARS),
    status: z.enum(["pending", "resolving", "allowed", "rejected"]),
  })
  .strict();
const exportDenied = z
  .object({
    kind: z.literal("denied"),
    tool: z.string(),
    title: z.string(),
    reason: z.string().max(MAX_AI_TEXT_CHARS),
  })
  .strict();
const exportError = z
  .object({
    kind: z.literal("error"),
    scope: z.enum(["submit", "model", "tool", "approval", "session"]),
    message: z.string().max(MAX_AI_TEXT_CHARS),
  })
  .strict();
const exportWorkspaceChanges = z
  .object({
    kind: z.literal("workspace-changes"),
    origin: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("app") }).strict(),
      z.object({ kind: z.literal("container"), connectionId: z.string(), containerId: z.string() }).strict(),
      z.object({ kind: z.literal("sandbox"), connectionId: z.string(), image: z.string() }).strict(),
    ]),
    workspaceRoot: z.string(),
    beforeCount: z.number().int().nonnegative(),
    afterCount: z.number().int().nonnegative(),
    introduced: z.array(z.string()),
    cleared: z.array(z.string()),
    updated: z.array(z.string()),
    contentChanged: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

// Data a plugin published. `data` is the plugin's own payload, so it is exported as-is after redaction —
// dropping it would make an export of a plugin-driven session silently incomplete.
const exportData = z
  .object({
    kind: z.literal("data"),
    customType: z.string(),
    data: z.unknown().optional(),
    text: z.string().optional(),
  })
  .strict();

// What the turn did that has no content of its own. Exported as the code, like the transcript holds it: an export
// that dropped it would show a conversation with a question and no answer and no reason for either.
const exportNotice = z.object({ kind: z.literal("notice"), notice: z.string() }).strict();

export const sessionExportSchema = z
  .object({
    version: z.literal(SESSION_EXPORT_VERSION),
    exportedAt: z.number().nonnegative(),
    session: z
      .object({
        title: z.string(),
        createdAt: z.number().nonnegative(),
        updatedAt: z.number().nonnegative(),
        providerId: z.string().optional(),
        model: z.string().optional(),
      })
      .strict(),
    entries: z
      .array(
        z.discriminatedUnion("kind", [
          exportMessage,
          exportTool,
          exportApproval,
          exportDenied,
          exportError,
          exportWorkspaceChanges,
          exportData,
          exportNotice,
        ]),
      )
      .max(MAX_SESSION_TIMELINE_ITEMS),
  })
  .strict();

export type SanitizedSessionExport = z.infer<typeof sessionExportSchema>;
type SanitizedSessionExportEntry = SanitizedSessionExport["entries"][number];

function messageContent(view: SessionView, item: Extract<SessionTimelineItem, { kind: "message" }>, index: number) {
  const streaming = view.streamingAssistant;
  return streaming?.id === item.id && streaming.timelineIndex === index ? streaming.content : item.content;
}

function sanitizeEntry(view: SessionView, item: SessionTimelineItem, index: number): SanitizedSessionExportEntry {
  switch (item.kind) {
    case "message":
      return redactPayload({
        kind: item.kind,
        role: item.role,
        content: messageContent(view, item, index),
        delivery: item.delivery,
        status: item.status,
      });
    case "tool":
      return redactPayload({
        kind: item.kind,
        tool: item.tool,
        title: item.title,
        args: item.args,
        status: item.status,
        ...(item.ok === undefined ? {} : { ok: item.ok }),
        ...(item.result === undefined ? {} : { result: item.result }),
        ...(item.message === undefined ? {} : { message: item.message }),
      });
    case "approval":
      return redactPayload({
        kind: item.kind,
        tool: item.tool,
        title: item.title,
        args: item.args,
        reason: item.reason,
        status: item.status,
      });
    case "denied":
      return redactPayload({ kind: item.kind, tool: item.tool, title: item.title, reason: item.reason });
    case "error":
      return redactPayload({ kind: item.kind, scope: item.scope, message: item.message });
    case "workspace-changes":
      return redactPayload({
        kind: item.kind,
        origin: item.origin,
        workspaceRoot: item.workspaceRoot,
        beforeCount: item.beforeCount,
        afterCount: item.afterCount,
        introduced: item.introduced,
        cleared: item.cleared,
        updated: item.updated,
        contentChanged: item.contentChanged,
        truncated: item.truncated,
      });
    case "data":
      return redactPayload({
        kind: item.kind,
        customType: item.customType,
        ...(item.data === undefined ? {} : { data: item.data }),
        ...(item.text === undefined ? {} : { text: item.text }),
      });
    case "notice":
      return redactPayload({ kind: item.kind, notice: item.notice });
  }
}

export function latestAssistantResponse(view: SessionView): string | undefined {
  for (let index = view.timeline.length - 1; index >= 0; index -= 1) {
    const item = view.timeline[index];
    if (item.kind !== "message" || item.role !== "assistant") continue;
    return messageContent(view, item, index) || undefined;
  }
  return undefined;
}

export function createSanitizedSessionExport(
  summary: SessionSummary,
  view: SessionView,
  exportedAt = Date.now(),
): SanitizedSessionExport {
  return sessionExportSchema.parse({
    version: SESSION_EXPORT_VERSION,
    exportedAt,
    session: {
      title: summary.title,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      ...(summary.providerId ? { providerId: summary.providerId } : {}),
      ...(summary.model ? { model: summary.model } : {}),
    },
    entries: view.timeline.map((item, index) => sanitizeEntry(view, item, index)),
  });
}

export function sessionExportFilename(title: string): string {
  const base = title
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return `${base || "session-export"}.json`;
}
