import type { LLMAdapter, LLMMessage } from "@open-multi-agent/core";

import { DEFAULT_MODEL_TIMEOUT_MS, MAX_THREAD_COMPACTION_SUMMARY_CHARS } from "@/ai-system/core/limits";
import type { CompactThreadContext, ThreadCompactionGenerationInput } from "@/ai-system/core/types";
import { responseText, tokenCount, validatedModelHistory } from "@/ai-system/runtime/omaSessionMessages";
import threadCompactionPrompt from "@/resources/prompts/thread-compaction.md?raw";
import threadCompactionRequest from "@/resources/prompts/thread-compaction-request.md?raw";
import { renderPrompt } from "@/template/renderPrompt";

type ThreadCompactionAdapterFactory = (input: ThreadCompactionGenerationInput) => LLMAdapter;

function sourceHistory(input: ThreadCompactionGenerationInput): LLMMessage[] {
  const history = validatedModelHistory(input.modelHistory);
  if (
    !history ||
    input.source.historyStart < 0 ||
    input.source.historyStart >= input.source.historyEnd ||
    input.source.historyEnd > history.length
  ) {
    throw new Error("AI: Thread compaction history is invalid");
  }
  return history.slice(input.source.historyStart, input.source.historyEnd);
}

export function makeCompactThreadContext(makeAdapter: ThreadCompactionAdapterFactory): CompactThreadContext {
  return async (input) => {
    const history = sourceHistory(input);
    const systemPrompt = renderPrompt(threadCompactionPrompt, { instructions: input.instructions?.trim() });
    const messages: LLMMessage[] = [
      ...history,
      { role: "user", content: [{ type: "text", text: threadCompactionRequest.trim() }] },
    ];
    const timeout = AbortSignal.timeout(DEFAULT_MODEL_TIMEOUT_MS);
    const response = await makeAdapter(input).chat(messages, {
      model: input.resolved.model ?? "unknown",
      systemPrompt,
      abortSignal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
    });
    const summary = responseText(response).trim();
    if (!summary || summary.length > MAX_THREAD_COMPACTION_SUMMARY_CHARS) {
      throw new Error("AI: Thread compaction summary is invalid");
    }
    return {
      summary,
      providerId: input.resolved.id,
      ...(response.model || input.resolved.model ? { model: response.model || input.resolved.model } : {}),
      inputTokens: tokenCount(response.usage.input_tokens),
      outputTokens: tokenCount(response.usage.output_tokens),
    };
  };
}
