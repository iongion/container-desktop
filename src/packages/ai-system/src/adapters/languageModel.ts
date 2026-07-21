import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { ResolvedProvider } from "@/ai-system/core/providers";

const PROVIDER_CREDENTIAL_PLACEHOLDER = "container-desktop-provider-credential";

// The SDK requires an apiKey to construct dedicated OpenAI/Anthropic requests and uses it to choose the right
// header shape. Give it a public sentinel only; createProviderFetch strips that header before the shell-specific
// fetch adapter injects the real keychain secret. The secret stays in Electron main, while Tauri/Wails deliberately
// handle it transiently in their trusted webview realm.
export function buildModelAuth(resolved: ResolvedProvider): { apiKey?: string; headers: Record<string, string> } {
  return {
    apiKey:
      resolved.auth.scheme === "bearer" || resolved.kind === "anthropic" || resolved.kind === "openai"
        ? PROVIDER_CREDENTIAL_PLACEHOLDER
        : undefined,
    headers: {},
  };
}

// Turns a resolved provider into an AI-SDK LanguageModel backed by the shell-specific credential-injecting fetch.
// Local servers (llama.cpp / LM Studio) and OpenAI-compatible clouds go through @ai-sdk/openai-compatible;
// Anthropic and OpenAI use their dedicated providers. Construction is lazy (no network).
export function createLanguageModel(resolved: ResolvedProvider, providerFetch: typeof fetch): LanguageModel {
  const { apiKey, headers } = buildModelAuth(resolved);
  switch (resolved.kind) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: resolved.baseURL, headers, fetch: providerFetch }).languageModel(
        resolved.model,
      );
    case "openai":
      return createOpenAI({ apiKey, baseURL: resolved.baseURL, headers, fetch: providerFetch }).languageModel(
        resolved.model,
      );
    default:
      return createOpenAICompatible({
        name: resolved.id,
        baseURL: resolved.baseURL,
        apiKey,
        headers,
        fetch: providerFetch,
      }).languageModel(resolved.model);
  }
}
