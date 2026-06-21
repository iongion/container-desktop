// ── AI subsystem core ports ─────────────────────────────────────
// Neutral, framework-agnostic PORT interfaces. No Electron/React/AI-SDK/node:*.
// Runtime implementations live in runtimes/node/; shell adapters in adapters/electron/.

import type { AIPermissionMode, CachedVerdict } from "./permissions";
import type { ResolvedProvider } from "./providers";
import type { AIAuthSettings, ListedModel } from "./types";

// ── Provider key store ───────────────────────────────────────────────────────
export interface EncryptionStatus {
  available: boolean;
  backend?: string;
  degraded: boolean;
}

export interface AIKeyStore {
  getEncryptionStatus(): EncryptionStatus;
  hasKey(provider: string): Promise<boolean>;
  getKey(provider: string): Promise<string | undefined>;
  setKey(provider: string, plaintext: string, opts?: { allowDegraded?: boolean }): Promise<void>;
  clearKey(provider: string): Promise<void>;
}

// ── Knowledge bank ──────────────────────────────────────────────────────────
export type KnowledgeDomain = "podman" | "docker" | "wsl" | "ssh" | "general";

export interface KnowledgeEntry {
  id: string;
  domain: KnowledgeDomain;
  title: string;
  symptom: string;
  solution: string;
  commands?: string[];
  tags?: string[];
}

export interface KnowledgeBankLike {
  search(query: string): Promise<KnowledgeEntry[]>;
}

// ── Model listing ───────────────────────────────────────────────────────────
export type { ListedModel };

export type ModelLister = (
  baseURL: string,
  opts?: { auth?: AIAuthSettings; secret?: string; fetchImpl?: typeof fetch; signal?: AbortSignal },
) => Promise<ListedModel[]>;

// ── Sandbox ─────────────────────────────────────────────────────────────────
export interface SandboxCommand {
  program: string;
  args: string[];
}

export type { CommandResult } from "./types";

export interface SandboxExecResult {
  ok: boolean;
  // A coarse status of the run ("ran" | "blocked" | "error"). The permission decision (run/ask/reject)
  // lives in the gating layer, not here.
  tier: string;
  reason: string;
  stdout: string;
  stderr: string;
  code: number | null;
  truncated: boolean;
  rejectedReason?: string;
}

// `enforceFloor` defaults true; the tool gate threads `false` in "always allow" mode so the catastrophic
// floor (denylist/metachars/traversal) is bypassed — every other structural guard (no shell, scrubbed env,
// timeout, output cap + redaction) still applies.
export type SandboxRunner = (cmd: SandboxCommand, opts?: { enforceFloor?: boolean }) => Promise<SandboxExecResult>;

// ── Agent ────────────────────────────────────────────────────────────────────
// Neutral message type for agent runs (the broker uses this; runtimes/node
// maps to AI-SDK ModelMessage).
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export type ToolSet = Record<string, unknown>;

export interface AgentRunnerParams {
  resolved: ResolvedProvider;
  secret?: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolSet;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onDone: (finishReason: string) => void;
  onError: (message: string) => void;
  /** Tool-call events the agent emits alongside prose deltas. Mock agents use this
   * to inject command badges, approval cards, etc. directly. Real agents wired
   * through the AI-SDK tool loop may ignore it (the SDK calls tools internally). */
  onToolEvent?: (event: import("./channels").AgentToolEvent) => void;
}

export type AgentRunner = (params: AgentRunnerParams) => void;

// Tool builders — injected into host so it never imports AI-SDK.
export interface AgentToolDeps {
  runSandboxed: SandboxRunner;
  searchKnowledge: (query: string) => Promise<KnowledgeEntry[]>;
  webSearch?: (query: string) => Promise<{ text: string }>;
  onEvent?: (event: import("./channels").AgentToolEvent) => void;
  /** Active permission mode for this run — governs run/ask/reject for the gated tools (runCommand, webSearch). */
  mode: AIPermissionMode;
  /** Remembered verdict for a command key (consulted only in "remember" mode); undefined ⇒ not yet decided. */
  cacheLookup?: (key: string) => CachedVerdict;
  /** Remembered verdict for the web-search switch (consulted only in "remember" mode). */
  webVerdict?: CachedVerdict;
}

export type BuildAgentTools = (deps: AgentToolDeps) => ToolSet;
