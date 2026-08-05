import { describe, expect, it } from "vitest";
import type { SessionView } from "@/ai-system/core/sessionEvents";
import {
  createSanitizedSessionExport,
  latestAssistantResponse,
  sessionExportFilename,
  sessionExportSchema,
} from "@/ai-system/core/sessionExport";
import type { SessionSummary } from "@/ai-system/core/sessions";

const summary: SessionSummary = {
  id: "session-secret-id",
  title: "Production / audit",
  titleOrigin: "user",
  createdAt: 10,
  updatedAt: 20,
  providerId: "openai",
  model: "gpt-test",
  phase: "model",
  lastSeq: 3,
};

const view: SessionView = {
  sessionId: summary.id,
  phase: "model",
  activeTaskId: "task-secret-id",
  lastSeq: 3,
  timeline: [
    {
      kind: "message",
      id: "user-secret-id",
      role: "user",
      content: "Inspect API_TOKEN=hidden",
      delivery: "applied",
      status: "complete",
    },
    {
      kind: "tool",
      id: "tool-secret-id",
      toolCallId: "call-secret-id",
      tool: "inspectContainer",
      title: "Inspect container",
      args: { authorization: "Bearer secret-value" },
      result: { token: "secret-value", status: "ok" },
      status: "complete",
      ok: true,
    },
    {
      kind: "message",
      id: "assistant-secret-id",
      role: "assistant",
      content: "Partial",
      delivery: "applied",
      status: "streaming",
    },
  ],
  streamingAssistant: { id: "assistant-secret-id", timelineIndex: 2, content: "Complete answer" },
};

describe("sanitized Session export", () => {
  it("exports a versioned redacted projection without internal runtime IDs", () => {
    const exported = createSanitizedSessionExport(summary, view, 30);

    expect(sessionExportSchema.parse(exported)).toEqual(exported);
    expect(exported).toMatchObject({
      version: 1,
      exportedAt: 30,
      session: {
        title: "Production / audit",
        createdAt: 10,
        updatedAt: 20,
        providerId: "openai",
        model: "gpt-test",
      },
      entries: [
        { kind: "message", content: "Inspect API_TOKEN=[REDACTED]" },
        {
          kind: "tool",
          args: { authorization: "[REDACTED]" },
          result: { token: "[REDACTED]", status: "ok" },
        },
        { kind: "message", content: "Complete answer" },
      ],
    });
    expect(JSON.stringify(exported)).not.toContain("secret-id");
    expect(JSON.stringify(exported)).not.toContain("secret-value");
  });

  it("returns the latest complete or streaming assistant response", () => {
    expect(latestAssistantResponse(view)).toBe("Complete answer");
    expect(
      latestAssistantResponse({ ...view, timeline: view.timeline.slice(0, 2), streamingAssistant: undefined }),
    ).toBe(undefined);
  });

  // A turn that produced nothing is part of what happened. An export that dropped it would show a question with no
  // answer and no reason for either — the same defect the transcript notice exists to close, one layer out.
  it("carries a turn notice through the export", () => {
    const withNotice: SessionView = {
      ...view,
      timeline: [...view.timeline, { kind: "notice", id: "notice-secret-id", notice: "empty-answer" }],
    };
    const exported = createSanitizedSessionExport(summary, withNotice, 1000);
    expect(exported.entries.at(-1)).toEqual({ kind: "notice", notice: "empty-answer" });
  });

  it("creates a bounded cross-platform JSON filename", () => {
    expect(sessionExportFilename(summary.title)).toBe("production-audit.json");
    expect(sessionExportFilename("***")).toBe("session-export.json");
    expect(sessionExportFilename("x".repeat(200))).toHaveLength(69);
  });
});
