import type {
  LLMAdapter,
  LLMChatOptions,
  LLMMessage,
  LLMResponse,
  LLMStreamOptions,
  StreamEvent,
} from "@open-multi-agent/core";
import { AISdkAdapter } from "@open-multi-agent/core/ai-sdk";
import { createLanguageModel } from "@/ai-system/adapters/languageModel";
import type { ResolvedProvider } from "@/ai-system/core/providers";

interface OmaAdapterOptions {
  agentName: string;
  onToken?: (agentName: string, delta: string, messages: readonly LLMMessage[]) => void;
}

// OMA's runner calls chat(), then emits the completed turn as one stream event. This adapter implements chat() over
// the AI-SDK adapter's real provider stream: token deltas reach the UI immediately while OMA still receives the one
// complete LLMResponse its unchanged tool loop expects.
export function createOmaAdapter(
  resolved: ResolvedProvider,
  providerFetch: typeof fetch,
  options?: OmaAdapterOptions,
): LLMAdapter {
  const delegate = new AISdkAdapter(createLanguageModel(resolved, providerFetch));
  return {
    name: resolved.id,
    capabilities: delegate.capabilities,
    async chat(messages: LLMMessage[], chatOptions: LLMChatOptions): Promise<LLMResponse> {
      let response: LLMResponse | undefined;
      for await (const event of delegate.stream(messages, chatOptions)) {
        if (event.type === "text") {
          const delta = String(event.data ?? "");
          if (delta && options?.onToken) options.onToken(options.agentName, delta, messages);
        } else if (event.type === "error") {
          throw event.data instanceof Error ? event.data : new Error(String(event.data));
        } else if (event.type === "done") {
          response = event.data as LLMResponse;
        }
      }
      if (!response) throw new Error(`AI provider ${resolved.id} ended its stream without a final response`);
      return response;
    },
    stream(messages: LLMMessage[], streamOptions: LLMStreamOptions): AsyncIterable<StreamEvent> {
      return delegate.stream(messages, streamOptions);
    },
  };
}
