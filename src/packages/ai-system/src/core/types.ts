// AI subsystem core types.
// OWNED by core; consumers import shared AI contracts from this module.
// No React/AI-SDK/node:* imports (zod is the neutral validation lib backing the boundary schemas).

import type { z } from "zod";
import type { AIPermissionMode } from "./permissions";
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
}

// Core-owned model-listing DTO used by both the channels contract and runtime implementations.
export interface ListedModel {
  id: string;
}

// EngineOps PORT — typed container-engine operations the assistant's first-class tools call. Neutral (type-only),
// implemented over EngineDataService (engineOpsAdapter). Reads are ungated; mutating
// methods are gated at the tool layer, never here. `connectionId` optional everywhere → primary/default connection.
export interface EngineContainer {
  Id: string;
  Image?: string;
  ImageName?: string;
  Name?: string;
  Names?: string[];
  State?: unknown;
  Status?: string;
  Computed?: { Name?: string; DecodedState?: string };
}

export interface EngineImage {
  Id: string;
  Name?: string;
  FullName?: string;
  Names?: string[];
  Tag?: string;
  Size?: number;
}

export interface EngineContainerStats {
  name?: string;
  memory_stats?: { usage?: number; limit?: number };
}

export interface EngineNetwork {
  id: string;
  name: string;
  driver?: string;
  dns_enabled?: boolean;
}

export interface EngineVolume {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
}

export interface EngineConnectionInfo {
  id: string;
  name: string;
  engine: string;
  running: boolean;
}

export interface EngineConnectionRef {
  connectionId?: string;
}

export interface EngineEntityRef extends EngineConnectionRef {
  id: string;
}

export interface EngineOps {
  listConnections(): EngineConnectionInfo[];
  listContainers(opts?: EngineConnectionRef): Promise<EngineContainer[]>;
  inspectContainer(opts: EngineEntityRef): Promise<EngineContainer | undefined>;
  getContainerLogs(opts: EngineEntityRef & { tail?: number; since?: string }): Promise<string>;
  getContainerStats(opts: EngineEntityRef): Promise<EngineContainerStats>;
  startContainer(opts: EngineEntityRef): Promise<boolean>;
  stopContainer(opts: EngineEntityRef): Promise<boolean>;
  restartContainer(opts: EngineEntityRef): Promise<boolean>;
  pauseContainer(opts: EngineEntityRef): Promise<boolean>;
  unpauseContainer(opts: EngineEntityRef): Promise<boolean>;
  removeContainer(opts: EngineEntityRef): Promise<boolean>;
  listImages(opts?: EngineConnectionRef): Promise<EngineImage[]>;
  inspectImage(opts: EngineEntityRef): Promise<EngineImage | undefined>;
  pullImage(opts: EngineConnectionRef & { reference: string }): Promise<boolean>;
  removeImage(opts: EngineEntityRef): Promise<boolean>;
  listNetworks(opts?: EngineConnectionRef): Promise<EngineNetwork[]>;
  inspectNetwork(opts: EngineEntityRef): Promise<EngineNetwork>;
  removeNetwork(opts: EngineEntityRef): Promise<boolean>;
  listVolumes(opts?: EngineConnectionRef): Promise<EngineVolume[]>;
  inspectVolume(opts: EngineEntityRef): Promise<EngineVolume>;
  removeVolume(opts: EngineEntityRef): Promise<boolean>;
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
