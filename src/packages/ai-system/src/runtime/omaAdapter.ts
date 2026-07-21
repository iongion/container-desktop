import type { LLMAdapter } from "@open-multi-agent/core";
import { AISdkAdapter } from "@open-multi-agent/core/ai-sdk";
import { createLanguageModel } from "@/ai-system/adapters/languageModel";
import type { ResolvedProvider } from "@/ai-system/core/providers";

// Bridges container-desktop's provider stack into an open-multi-agent LLMAdapter. The Vercel AI-SDK model is built by
// the app's own createLanguageModel (catalog + keychain + the shell providerFetch), so the real API key stays at the
// host boundary and OMA's bundled @anthropic-ai/sdk/openai clients are never imported into the webview bundle. Only
// the "@open-multi-agent/core/ai-sdk" subpath is pulled at runtime (a node-builtin-free closure); LLMAdapter is a
// type-only import (erased at build).
export function createOmaAdapter(resolved: ResolvedProvider, providerFetch: typeof fetch): LLMAdapter {
  return new AISdkAdapter(createLanguageModel(resolved, providerFetch));
}
