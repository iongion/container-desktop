// AI subsystem core types
// OWNED by core. env/Types re-exports these for existing consumers.
// No Electron/React/AI-SDK/node:* imports.

import type { AIPermissionMode } from "./permissions";

// Local-first. Provider API keys are NEVER stored here in plaintext — they live in the OS
// keychain via Electron safeStorage (see ai/keyStore).
export interface AIProviderSettings {
  model: string;
  // Local providers (llamacpp/lmstudio) point this at a loopback OpenAI-compatible server.
  baseURL?: string;
  // How to authenticate to this provider's endpoint. Absent → the catalog default scheme (see
  // providers.ts `defaultAuthScheme`). The secret itself is NEVER here — it is the one keychain string
  // per provider id (bearer token / basic password / custom-header value).
  auth?: AIAuthSettings;
}

// Connection auth for a provider endpoint: None (keyless local) / Bearer (API key on the AI-SDK native
// apiKey arg) / Basic (username here, password in the keychain) / Custom header (name here, value in the
// keychain). Lets a hardened LM Studio and exotic gateways be reached. The secret never lives here.
export type AIAuthScheme = "none" | "bearer" | "basic" | "header";

export interface AIAuthSettings {
  scheme: AIAuthScheme;
  // basic: the non-secret username (the password is the keychain secret).
  username?: string;
  // header: the custom header name (its value is the keychain secret).
  headerName?: string;
}

// AI is always on (no master switch). "Local vs cloud" is a property of the selected provider
// (catalog `cloud` flag), not a global flag. Cloud consent is expressed by saving a provider's
// API key — there is no separate allow-cloud / local-only toggle. See ai/egress + ai/keyStore.
export interface AISettings {
  defaultProvider: string;
  // Opt-in master for the agent's web-search tool. The permission mode caps it (off in "ask" unless the
  // user approves a search; runs in "remember" if enabled / per the web switch; forced on in "allow").
  webSearch: boolean;
  providers: Record<string, AIProviderSettings>;
  // How tool calls are gated: "ask" (always prompt) / "remember" (prompt only when not yet decided,
  // persisting allow/reject to the permission cache) / "allow" (run everything, no prompt, no floor).
  // Absent → "ask" (safest). The allow/reject records live in a dedicated file, NOT here.
  permissionMode?: AIPermissionMode;
}

// Core-owned sandbox result DTO. The app's CommandExecutionResult is a separate type in env/Types;
// the sandbox exec adapter maps between them.
export interface CommandResult {
  ok: boolean;
  tier: string;
  stdout: string;
  stderr: string;
  code: number | null;
  truncated: boolean;
  rejectedReason?: string;
}

// Core-owned model-listing DTO used by both the channels contract and runtime implementations.
export interface ListedModel {
  id: string;
}
