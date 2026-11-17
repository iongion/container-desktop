// AI subsystem core types.
// OWNED by core; consumers import shared AI contracts from this module.
// No React/AI-SDK/node:* imports (zod is the neutral validation lib backing the boundary schemas).

import type { z } from "zod";
import type { AIPermissionMode } from "@/mcp-server/core/permissions";
import type { ProviderKind } from "./providers";
import type { approvalDecision, diagnosticsBundle } from "./schemas";
import type { SkillInvocationProvenance } from "./skills";

export type SessionRole = "user" | "assistant" | "system";

export interface SessionMessage {
  id: string;
  role: SessionRole;
  content: string;
  createdAt: number;
  skill?: SkillInvocationProvenance;
}

export type DiagnosticsBundle = z.infer<typeof diagnosticsBundle>;
export type ApprovalDecision = z.infer<typeof approvalDecision>;

// Local-first. Provider API keys are NEVER stored here in plaintext — they live in the OS
// keychain via the shell's key store (see ai/keyStore).
export interface AIProviderSettings {
  model: string;
  // Local providers (llamacpp/lmstudio) point this at a loopback OpenAI-compatible server.
  baseURL?: string;
  // How to authenticate to this provider's endpoint. Absent → the catalog default scheme (see
  // providers.ts `defaultAuthScheme`). The secret itself is NEVER here — it is the one keychain string
  // per provider id (bearer token / basic password / custom-header value).
  auth?: AIAuthSettings;
  // Non-secret cache generation. Incremented only after a credential mutation succeeds so model-discovery
  // queries never reuse results obtained with a previous key.
  credentialRevision?: number;
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
// (catalog `cloud` flag), not a global flag. Selecting or saving a provider endpoint is the destination choice;
// model APIs do not use the agent tool-permission system.
export interface AISettings {
  defaultProvider: string;
  // Opt-in master for the agent's web-search tool. Permission mode and remembered verdict decide whether an
  // enabled search runs, asks, or is denied. No permission mode silently enables this feature.
  webSearch: boolean;
  providers: Record<string, AIProviderSettings>;
  // How tool calls are gated: "ask" (always prompt) / "remember" (prompt only when not yet decided,
  // persisting allow/reject to the permission cache) / "allow" (run everything, no prompt, no floor).
  // Absent → "ask" (safest). The allow/reject records live in a dedicated file, NOT here.
  permissionMode?: AIPermissionMode;
  // Absolute path to the single project folder the workspace tools may read/edit/run in. Absent → workspace tools
  // are unavailable. The host capability confines ALL file access to this root (canonicalized, no escapes).
  workspaceRoot?: string;
  // The session the assistant REUSES on each connection, keyed by connection id. This is what makes "start a session"
  // a one-time question: a configured entry names everything a boot needs to adopt or recreate the pair, and an
  // absent one is how "not set up on this engine yet" is expressed. Per connection because a session's containers
  // live on ONE engine — reaching it is what a connection is.
  defaultSessions?: Record<string, AIDefaultSessionConfig>;
}

// What the reusable session was configured with. Only the workspace is required: it is the folder that gets mounted
// and written to, so it is the one thing the app must never guess. Everything else falls back to the app's own
// defaults at resolve time, which keeps a session set up before a model was chosen working.
export interface AIDefaultSessionConfig {
  workspacePath: string;
  providerId?: string;
  modelId?: string;
  egress?: boolean;
  // What the user called it. Absent means this is the connection's offered default rather than one they named.
  name?: string;
}

// Core-owned model-listing DTO used by both the channels contract and runtime implementations.
export interface ListedModel {
  id: string;
}

// Provider HTTP transport (shell-specific: the Tauri/Wails trusted-webview fetch). The
// credential reference names the keychain entry + auth shape and binds injection to `origin`; the secret itself
// never appears here. Byte/timeout bounds live beside their sole consumer in runtimes/providerFetch.
export interface ProviderCredentialReference {
  providerId: string;
  providerKind: ProviderKind;
  origin: string;
  auth: AIAuthSettings;
}

export interface ProviderTransportRequest {
  credential: ProviderCredentialReference;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface ProviderTransportResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
}

export interface ProviderTransport {
  request(request: ProviderTransportRequest, signal: AbortSignal): Promise<ProviderTransportResponse>;
  dispose(): void;
}
