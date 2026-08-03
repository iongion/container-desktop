import { describe, expect, it } from "vitest";
import type { ThreadView } from "@/ai-system/core/threadEvents";
import {
  createSanitizedThreadExport,
  latestAssistantResponse,
  threadExportFilename,
  threadExportSchema,
} from "@/ai-system/core/threadExport";
import type { ThreadSummary } from "@/ai-system/core/threads";

const summary: ThreadSummary = {
  id: "thread-secret-id",
  title: "Production / audit",
  titleOrigin: "user",
  createdAt: 10,
  updatedAt: 20,
  providerId: "openai",
  model: "gpt-test",
  phase: "model",
  lastSeq: 3,
};

const view: ThreadView = {
  threadId: summary.id,
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

describe("sanitized Thread export", () => {
  it("exports a versioned redacted projection without internal runtime IDs", () => {
    const exported = createSanitizedThreadExport(summary, view, 30);

    expect(threadExportSchema.parse(exported)).toEqual(exported);
    expect(exported).toMatchObject({
      version: 1,
      exportedAt: 30,
      thread: {
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

  it("creates a bounded cross-platform JSON filename", () => {
    expect(threadExportFilename(summary.title)).toBe("production-audit.json");
    expect(threadExportFilename("***")).toBe("thread-export.json");
    expect(threadExportFilename("x".repeat(200))).toHaveLength(69);
  });
});
