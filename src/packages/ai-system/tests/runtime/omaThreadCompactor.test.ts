import type { LLMAdapter, LLMMessage, LLMResponse } from "@open-multi-agent/core";
import { describe, expect, it } from "vitest";

import type { ResolvedProvider } from "@/ai-system/core/providers";
import { makeCompactThreadContext } from "@/ai-system/runtime/omaThreadCompactor";

const resolved = { id: "openrouter", model: "summary-model" } as ResolvedProvider;

function response(text: string): LLMResponse {
  return {
    id: "summary-response",
    content: [{ type: "text", text }],
    model: "summary-model",
    stop_reason: "end_turn",
    usage: { input_tokens: 120, output_tokens: 30 },
  };
}

describe("OMA Thread compactor", () => {
  it("summarizes only the approved canonical range with bounded operator instructions", async () => {
    const calls: Array<{ messages: LLMMessage[]; systemPrompt?: string }> = [];
    const adapter: LLMAdapter = {
      name: "summary",
      async chat(messages, options) {
        calls.push({ messages: structuredClone(messages), systemPrompt: options.systemPrompt });
        return response(" Decisions, failures, and the unresolved follow-up. ");
      },
      async *stream() {},
    };
    const compact = makeCompactThreadContext(() => adapter);
    const modelHistory = [
      { role: "user", content: [{ type: "text", text: "old question" }] },
      { role: "assistant", content: [{ type: "text", text: "old answer" }] },
      { role: "user", content: [{ type: "text", text: "recent question" }] },
    ];

    await expect(
      compact({
        resolved,
        providerFetch: globalThis.fetch,
        modelHistory,
        source: { historyStart: 0, historyEnd: 2, messageStartId: "old-user", messageEndId: "old-assistant" },
        instructions: "Preserve failed attempts.",
      }),
    ).resolves.toEqual({
      summary: "Decisions, failures, and the unresolved follow-up.",
      providerId: "openrouter",
      model: "summary-model",
      inputTokens: 120,
      outputTokens: 30,
    });
    expect(calls[0].messages.slice(0, 2)).toEqual(modelHistory.slice(0, 2));
    expect(JSON.stringify(calls[0].messages)).not.toContain("recent question");
    expect(calls[0].systemPrompt).toContain("Preserve failed attempts.");
    expect(calls[0].systemPrompt).toContain("Never invent");
  });

  it("rejects invalid canonical history and empty summaries", async () => {
    const adapter: LLMAdapter = {
      name: "empty",
      async chat() {
        return response("   ");
      },
      async *stream() {},
    };
    const compact = makeCompactThreadContext(() => adapter);
    const input = {
      resolved,
      providerFetch: globalThis.fetch,
      modelHistory: [{ role: "invalid" }],
      source: { historyStart: 0, historyEnd: 1, messageStartId: "one", messageEndId: "one" },
    };

    await expect(compact(input)).rejects.toThrow(/history/i);
    await expect(
      compact({
        ...input,
        modelHistory: [{ role: "user", content: [{ type: "text", text: "valid" }] }],
      }),
    ).rejects.toThrow(/summary/i);
  });
});
