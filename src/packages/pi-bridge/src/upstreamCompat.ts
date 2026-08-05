// What the UPSTREAM wants on the wire, which our own gateway hides from pi.
//
// pi decides these per model from `model.provider` and `model.baseUrl` (`detectCompat`, pi-ai
// `api/openai-completions.js`). Ours are `container-desktop-gateway` and a container-internal URL, so every
// upstream reads to pi as plain OpenAI: the system prompt goes as role `developer`, `store: false` is sent,
// `max_completion_tokens` is used where the server wants `max_tokens`, and a thinking level travels as
// `reasoning_effort` where the server wants an object of its own. None of that bit while no model reasoned; the
// developer role and the thinking shape are both gated on `model.reasoning`, which the app now sets from what a
// provider published.
//
// `compat` is the slot pi merges field by field over its own detection (`getCompat`: `model.compat.X ?? detected.X`),
// so naming only what differs leaves every other rule pi's. Matched on the upstream's own base URL, which is the
// same input pi would use — so a custom endpoint pointed at one of these hosts is read the same way as the
// catalogue entry, and nothing has to be kept in step with a provider id.
//
// Only the upstreams this app can be pointed at are here. Everything else answers `undefined`: pi's own reading of
// that host is already what it gives our gateway, and a guess would be worse than its default.

// pi's `OpenAICompletionsCompat`, narrowed to the fields we have a reason to set. A field pi never reads without
// another one being true (`sessionAffinityFormat`, which needs `sendSessionAffinityHeaders`) is left out rather
// than set for symmetry.
export interface PiUpstreamCompat {
  // Sends `store: false`. A server that rejects unknown body fields answers 400 to it.
  supportsStore?: boolean;
  // With a reasoning model, sends the system prompt as role `developer` instead of `system`.
  supportsDeveloperRole?: boolean;
  // Whether `reasoning_effort` may accompany the upstream's own thinking field.
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  // Every replayed assistant message must carry a reasoning field once thinking is on.
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: "openai" | "openrouter" | "deepseek" | "zai";
  cacheControlFormat?: "anthropic";
}

// pi's own substring tests, kept as pi wrote them — including their looseness, because being stricter here would
// mean a level travelling in a shape pi's own detection would not have chosen.
function matches(baseUrl: string, hosts: readonly string[]): boolean {
  return hosts.some((host) => baseUrl.includes(host));
}

export function piUpstreamCompat(upstreamBaseUrl: string | undefined, modelId: string): PiUpstreamCompat | undefined {
  const baseUrl = upstreamBaseUrl?.trim();
  if (!baseUrl) return undefined;

  // DeepSeek: `thinking: {type}` plus `reasoning_effort`, and it rejects the OpenAI-only fields.
  if (matches(baseUrl, ["deepseek.com"])) {
    return {
      supportsStore: false,
      supportsDeveloperRole: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    };
  }

  // Zhipu/GLM, on either host it serves: `thinking: {type}` alone, and `max_tokens` for the completion cap.
  if (matches(baseUrl, ["api.z.ai", "open.bigmodel.cn"])) {
    return {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
      thinkingFormat: "zai",
    };
  }

  // OpenRouter normalises reasoning across the providers it fronts, as `reasoning: {effort}`. The developer role
  // and Anthropic's cache markers depend on WHICH upstream it routes to, which its aggregated ids name.
  if (matches(baseUrl, ["openrouter.ai"])) {
    const routesToAnthropic = modelId.startsWith("anthropic/");
    return {
      supportsDeveloperRole: routesToAnthropic || modelId.startsWith("openai/"),
      thinkingFormat: "openrouter",
      ...(routesToAnthropic ? { cacheControlFormat: "anthropic" as const } : {}),
    };
  }

  return undefined;
}
