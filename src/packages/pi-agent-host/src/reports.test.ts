import { describe, expect, it } from "vitest";

import { type PiSessionFacts, sessionContextReport, sessionUsageReport } from "@/pi-agent-host/reports";

const facts = (patch: Partial<PiSessionFacts> = {}): PiSessionFacts => ({
  model: "qwen3-4b",
  systemPrompt: "you are a container assistant",
  activeToolNames: ["read", "listContainers"],
  tools: [
    { name: "read", description: "read a file" },
    { name: "listContainers", description: "list containers" },
    { name: "write", description: "write a file" },
  ],
  stats: {
    userMessages: 2,
    assistantMessages: 3,
    toolCalls: 4,
    tokens: { input: 1200, output: 340 },
    cost: 0.0012,
    contextUsage: { tokens: 5000, contextWindow: 128000 },
  },
  maxOutputTokens: 4096,
  compacted: false,
  ...patch,
});

describe("sessionUsageReport", () => {
  // These are pi's own aggregates over every entry it recorded, so they survive a compaction — which is exactly
  // why they are read off the session instead of counted from the bridge events the app happened to see.
  it("reports what the session has spent", () => {
    expect(sessionUsageReport(facts())).toEqual({
      requests: 3,
      inputTokens: 1200,
      outputTokens: 340,
      costUsd: 0.0012,
    });
  });
});

describe("sessionContextReport", () => {
  it("reports the model, its window, and only the tools the model was offered", () => {
    const report = sessionContextReport(facts());
    expect(report).toMatchObject({
      model: "qwen3-4b",
      contextTokens: 5000,
      contextWindow: 128000,
      maxOutputTokens: 4096,
      systemPromptChars: "you are a container assistant".length,
      messages: { user: 2, assistant: 3, toolCalls: 4 },
      compacted: false,
    });
    // `write` is registered but not active this turn — reporting it would claim the model could call it.
    expect(report.tools).toEqual([
      { name: "read", description: "read a file" },
      { name: "listContainers", description: "list containers" },
    ]);
  });

  // Right after a compaction pi has no estimate until the next response. Reporting 0 would read as an empty
  // context; null says "not known yet", which the app renders as an unknown budget.
  it("passes on an unknown estimate rather than inventing a zero", () => {
    const report = sessionContextReport(facts({ stats: { ...facts().stats, contextUsage: undefined } }));
    expect(report.contextTokens).toBeNull();
    expect(report.contextWindow).toBe(0);
  });

  it("says when the session has been compacted, since part of the history is then a summary", () => {
    expect(sessionContextReport(facts({ compacted: true })).compacted).toBe(true);
  });

  it("drops a tool the active list names but the registry does not know", () => {
    const report = sessionContextReport(facts({ activeToolNames: ["read", "ghost"] }));
    expect(report.tools).toEqual([{ name: "read", description: "read a file" }]);
  });
});
