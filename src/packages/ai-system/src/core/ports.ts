// AI subsystem core ports
// Neutral, framework-agnostic PORT interfaces. No Electron/React/AI-SDK/node:*.
// Shell adapters wire these to platform capability impls (platform/{electron,tauri}/capabilities).

import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import type { EngineOps } from "./types";

// Provider key store = the AI subsystem's view of the generic host Keychain port. Provider keys ARE the
// keychain entries (the `key` argument is the provider id); the broker consumes AIKeyStore, and both shells
// implement IKeychain under platform/{electron,tauri}/capabilities.
export interface EncryptionStatus {
  available: boolean;
  backend?: string;
  degraded: boolean;
}

export interface AIKeyStore {
  getEncryptionStatus(): EncryptionStatus;
  hasKey(key: string): Promise<boolean>;
  getKey(key: string): Promise<string | undefined>;
  setKey(key: string, plaintext: string, opts?: { allowDegraded?: boolean }): Promise<void>;
  clearKey(key: string): Promise<void>;
}

// Knowledge bank
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

// Sandbox
export interface SandboxCommand {
  program: string;
  args: string[];
}

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

export interface AgentExecutionDeps {
  runSandboxed: SandboxRunner;
  searchKnowledge: (query: string) => Promise<KnowledgeEntry[]>;
  webSearch?: (query: string) => Promise<{ text: string }>;
  engineOps?: EngineOps;
  engineToolTimeoutMs?: number;
  // The confined project workspace the workspace tools (readFile/editFile/searchText/…) act on. Absent ⇒ no workspace
  // tools are offered. Supplied by the shell composition root; the host impl enforces workspace-root confinement.
  workspaceAccess?: IWorkspaceAccess;
}

export interface AgentToolDeps extends AgentExecutionDeps {
  enforceFloorFor?: (toolCallId: string) => boolean;
}
