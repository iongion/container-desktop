// Main-only diagnostic-agent runner. Wraps AI-SDK streamText with a tool set
// and a hard step cap (stopWhen: stepCountIs). Mirrors chat.ts's streamer contract: text deltas →
// onDelta, settle → onDone(finishReason), throw → onError, AbortSignal cancels. The tool timeline is
// emitted by the tools themselves (their injected onEvent); this runner streams the model's prose.
// buildModel is injectable so tests pass a mock model instead of a real provider.

import { type LanguageModel, type ModelMessage, stepCountIs, streamText } from "ai";

import type { ResolvedProvider } from "@/ai-system/core";
import { createLanguageModel } from "../languageModel";

const DEFAULT_MAX_STEPS = 8;

export interface AgentRunParams {
  resolved: ResolvedProvider;
  secret?: string;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, any>;
  maxSteps?: number;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onDone: (finishReason: string) => void;
  onError: (message: string) => void;
}

export type AgentRunner = (params: AgentRunParams) => void;

export function createAgentRunner(
  deps: { buildModel?: (resolved: ResolvedProvider, secret?: string) => LanguageModel } = {},
): AgentRunner {
  const buildModel = deps.buildModel ?? createLanguageModel;
  return ({
    resolved,
    secret,
    system,
    messages,
    tools,
    maxSteps = DEFAULT_MAX_STEPS,
    signal,
    onDelta,
    onDone,
    onError,
  }) => {
    let model: LanguageModel;
    try {
      model = buildModel(resolved, secret);
    } catch (error: any) {
      onError(error?.message ?? String(error));
      return;
    }
    const result = streamText({
      model,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(maxSteps),
      abortSignal: signal,
    });
    void (async () => {
      try {
        for await (const delta of result.textStream) {
          onDelta(delta);
        }
        onDone(await result.finishReason);
      } catch (error: any) {
        if (signal.aborted) {
          onDone("abort");
          return;
        }
        onError(error?.message ?? String(error));
      }
    })();
  };
}
