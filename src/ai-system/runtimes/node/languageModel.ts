import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import { buildAuthHeaders, type ResolvedProvider } from "@/ai-system/core";

// Split a resolved provider's keychain secret into AI-SDK auth params. Bearer rides the NATIVE apiKey arg
// (so @ai-sdk/anthropic sends x-api-key and @ai-sdk/openai sends Authorization: Bearer — a hand-built
// Authorization header would 401 Anthropic); basic / custom-header go through the `headers` option; none
// sends nothing. Exported for unit tests.
export function buildModelAuth(
  resolved: ResolvedProvider,
  secret?: string,
): { apiKey?: string; headers: Record<string, string> } {
  return {
    apiKey: resolved.auth.scheme === "bearer" ? secret : undefined,
    headers: buildAuthHeaders(resolved.auth, secret),
  };
}

// Main-only. Turns a resolved provider (+ its decrypted keychain secret) into an AI-SDK LanguageModel. Both
// local servers (llama.cpp / LM Studio) and OpenAI-compatible clouds go through @ai-sdk/openai-compatible;
// Anthropic and OpenAI use their dedicated providers. Construction is lazy (no network). See.
export function createLanguageModel(resolved: ResolvedProvider, secret?: string): LanguageModel {
  const { apiKey, headers } = buildModelAuth(resolved, secret);
  switch (resolved.kind) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: resolved.baseURL, headers }).languageModel(resolved.model);
    case "openai":
      return createOpenAI({ apiKey, baseURL: resolved.baseURL, headers }).languageModel(resolved.model);
    default:
      return createOpenAICompatible({ name: resolved.id, baseURL: resolved.baseURL, apiKey, headers }).languageModel(
        resolved.model,
      );
  }
}
