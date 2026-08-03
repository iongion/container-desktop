// AI subsystem core types.
// OWNED by core; consumers import shared AI contracts from this module.
// No React/AI-SDK/node:* imports (zod is the neutral validation lib backing the boundary schemas).

import type { z } from "zod";
import type { FloorScope } from "./commandFloor";
import type { EffectiveContextSource } from "./context";
import type {
  AIPermissionMode,
  PermissionDecisionContext,
  PermissionsSnapshot,
  PermissionsStoreLike,
  WorkerToolPolicyMode,
} from "./permissions";
import type { AgentExecutionDeps } from "./ports";
import type { ProviderKind, ResolvedProvider } from "./providers";
import type { ReasoningThinking } from "./reasoning";
import type { ResolveRunPlanResult, RunEventEnvelope, RunView, StartRunResult } from "./runEvents";
import type { approvalDecision, diagnosticsBundle } from "./schemas";
import type { SkillInvocationProvenance } from "./skills";
import type { ResolveThreadApprovalResult, SubmitThreadResult, ThreadEventEnvelope, ThreadView } from "./threadEvents";
import type { ThreadCompaction } from "./threads";
import type { ToolArtifactReference } from "./toolArtifacts";

export type ThreadRole = "user" | "assistant" | "system";

export interface ThreadMessage {
  id: string;
  role: ThreadRole;
  content: string;
  createdAt: number;
  skill?: SkillInvocationProvenance;
}

export interface AgentSessionInputMessage {
  id: string;
  content: string;
  createdAt: number;
  displayContent?: string;
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

// Neutral session-actor PORT. The host supplies resolved task settings + execution capabilities; the concrete
// AI-SDK actor (runtimes/agent) owns rich model history, streams, tools, and approval state.
export interface AgentSessionTaskSettings {
  resolved: ResolvedProvider;
  providerFetch: typeof fetch;
  system: string;
  permissionMode: AIPermissionMode;
  permissions?: PermissionsSnapshot;
  // Host-resolved authority scope. Without it remembered decisions are ignored and never persisted.
  permissionContext?: PermissionDecisionContext;
  thinking?: ReasoningThinking;
  execution: AgentExecutionDeps;
  // Per-turn skill policy can only narrow the normal execution toolset. Undefined keeps every Thread tool.
  allowedTools?: ReadonlySet<string>;
  // Project-controlled prompt content must ask again before its first gated action, even with a remembered allow.
  initialTaint?: boolean;
  // Provenance metadata for prompt sections already rendered into `system` or the current skill input.
  // Values never contain the prompt text itself.
  contextSources?: readonly EffectiveContextSource[];
}

export interface AgentSessionPort {
  submit(message: AgentSessionInputMessage, taskSettings?: AgentSessionTaskSettings): Promise<SubmitThreadResult>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<ResolveThreadApprovalResult>;
  cancel(): Promise<void>;
  snapshot(): ThreadView;
  durableSnapshot(): AgentSessionDurableSnapshot;
  dispose(): Promise<void>;
}

export interface AgentSessionDurableSnapshot {
  view: ThreadView;
  modelHistory: unknown[];
  traceRecords?: unknown[];
}

export interface AgentSessionCreationOptions {
  threadId: string;
  history: ThreadMessage[];
  view?: ThreadView;
  modelHistory?: unknown[];
  activeCompaction?: ThreadCompaction;
  taskSettings: AgentSessionTaskSettings;
  permissionsStore?: PermissionsStoreLike;
  storeToolArtifact?: (input: {
    threadId: string;
    toolCallId: string;
    tool: string;
    content: string;
    byteLength: number;
  }) => Promise<ToolArtifactReference>;
  emit: (event: ThreadEventEnvelope) => void;
  logger?: { error: (...args: unknown[]) => void };
}

export type CreateAgentSession = (options: AgentSessionCreationOptions) => AgentSessionPort;

export interface ThreadCompactionGenerationInput {
  resolved: ResolvedProvider;
  providerFetch: typeof fetch;
  modelHistory: unknown[];
  source: ThreadCompaction["source"];
  instructions?: string;
  signal?: AbortSignal;
}

export interface ThreadCompactionGenerationResult {
  summary: string;
  providerId: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
}

export type CompactThreadContext = (
  input: ThreadCompactionGenerationInput,
) => Promise<ThreadCompactionGenerationResult>;

// Neutral team-run PORT — the multi-agent counterpart to AgentSessionPort. The host resolves provider access and
// the cost caps; the engine (@/ai-system/runtime) owns decomposition, scheduling and synthesis and reports as
// RunEventEnvelopes the renderer folds with reduceRunEvent. A Run is an explicit screen action, never the
// default chat path, because a single run fans out over many model turns.
export interface RunBudget {
  // Cumulative input+output tokens the run may spend before it stops early with finishReason "budget".
  maxTokens: number;
  maxTasks: number;
}

// One library worker as the ENGINE sees it: fully resolved host-side, so the driver never reads settings, never
// touches the keychain, and never decides policy. The wire carries only worker ids (startRunRequest.workerIds);
// everything here was looked up from the user's own stored definitions.
export interface ResolvedWorker {
  id: string;
  name: string;
  // What this worker is good at — goes into the coordinator's roster, so it is what the model reads when
  // deciding which worker a task belongs to.
  specialty: string;
  // Base agent prompt + the worker's own, already concatenated.
  system: string;
  resolved: ResolvedProvider;
  // Bound to THIS worker's provider origin + credential, so two workers on two providers cannot cross-send keys.
  providerFetch: typeof fetch;
  policy: WorkerToolPolicyMode;
  permissionContext?: PermissionDecisionContext;
  // Present only for a "granular" policy. Undefined means "do not filter"; an empty set means "no tools at all".
  allowedTools?: ReadonlySet<string>;
  // How strictly the command floor applies for this worker, derived from its execution target. Absent ⇒ strict.
  // Populated when the run host resolves the worker's execution backend.
  floorScope?: FloorScope;
  // The worker's own execution backend (engineOps + workspace bound to its target). Absent ⇒ the orchestrator
  // uses the run-level execution (host). Populated when the run host resolves a per-worker "Runs on" target.
  execution?: AgentExecutionDeps;
}

export interface TeamRunTaskSettings {
  resolved: ResolvedProvider;
  providerFetch: typeof fetch;
  // Optional cheaper model for decomposition + synthesis: the coordinator reasons over task titles and summaries
  // rather than raw tool output, so it rarely needs the workers' frontier model. Absent ⇒ reuse the worker model.
  coordinatorModel?: string;
  system: string;
  permissionMode: AIPermissionMode;
  permissions?: PermissionsSnapshot;
  permissionContext?: PermissionDecisionContext;
  execution: AgentExecutionDeps;
  budget: RunBudget;
  // The resolved roster for this run. Absent or empty ⇒ every task uses the run defaults above, which is the
  // pre-workers behaviour byte for byte.
  workers?: readonly ResolvedWorker[];
}

export interface TeamRunPort {
  start(): Promise<StartRunResult>;
  resolvePlan(decision: ApprovalDecision): Promise<ResolveRunPlanResult>;
  // Resolve ONE worker's gated tool call. Keyed by approvalId rather than by run, because workers execute in
  // parallel and several can be blocked at once — the run keeps making progress on its other branches meanwhile.
  resolveToolApproval(approvalId: string, decision: ApprovalDecision): Promise<ResolveRunPlanResult>;
  cancel(): Promise<void>;
  snapshot(): RunView;
  dispose(): Promise<void>;
}

export interface TeamRunCreationOptions {
  runId: string;
  goal: string;
  taskSettings: TeamRunTaskSettings;
  permissionsStore?: PermissionsStoreLike;
  emit: (envelope: RunEventEnvelope) => void;
  logger?: { error: (...args: unknown[]) => void };
}

export type CreateTeamRun = (options: TeamRunCreationOptions) => TeamRunPort;
