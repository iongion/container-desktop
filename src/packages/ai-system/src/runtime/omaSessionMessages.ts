import type { ContentBlock, LLMMessage, LLMResponse } from "@open-multi-agent/core";
import type { AgentSessionCreationOptions } from "@/ai-system/core/types";

const LLM_BLOCK_TYPES = new Set(["text", "reasoning", "image", "tool_use", "tool_result"]);

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function responseText(response: LLMResponse): string {
  return response.content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function isLlmMessage(value: unknown): value is LLMMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as { role?: unknown; content?: unknown };
  if (record.role !== "user" && record.role !== "assistant") return false;
  if (!Array.isArray(record.content)) return false;
  return record.content.every(
    (block) => !!block && typeof block === "object" && LLM_BLOCK_TYPES.has(String((block as { type?: unknown }).type)),
  );
}

export function validatedModelHistory(value: readonly unknown[]): LLMMessage[] | undefined {
  return value.length > 0 && value.every(isLlmMessage) ? (structuredClone(value) as LLMMessage[]) : undefined;
}

export function seedModelHistory(options: AgentSessionCreationOptions): LLMMessage[] {
  const restored = validatedModelHistory(options.modelHistory ?? []);
  if (restored) return restored;
  return options.history.flatMap((message) =>
    message.role === "user" || message.role === "assistant"
      ? [{ role: message.role, content: [{ type: "text" as const, text: message.content }] }]
      : [],
  );
}

export function tokenCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}
