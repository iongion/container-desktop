// AI subsystem core ports
// Neutral, framework-agnostic PORT interfaces. No React/AI-SDK/node:*.
// Shell adapters wire these to platform capability impls (platform/{tauri,wails}/capabilities).

import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import type { FloorScope } from "./commandFloor";
import type { EngineOps } from "./types";
import type { WorkerExecutionTarget } from "./workers";
import type { WorkspaceChangesPort } from "./workspaceChanges";

// Provider key store = the AI subsystem's view of the generic host Keychain port. Provider keys ARE the
// keychain entries (the `key` argument is the provider id); the broker consumes AIKeyStore, and both shells
// implement IKeychain under platform/{tauri,wails}/capabilities.
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
  workspaceChanges?: WorkspaceChangesPort;
}

export interface AgentToolDeps extends AgentExecutionDeps {
  enforceFloorFor?: (toolCallId: string) => boolean;
}

// Captured (non-interactive) command execution against one of the app's connections — the backend that lets a
// worker run on a remote host or inside a container instead of the local box. Resolution of a connectionId to a
// live engine host, and the SSH/WSL/Lima transport wrapping, live in the platform impl; core only sees this port.
export interface ConnectionExecResult {
  // Process exit code, or null if terminated by a signal.
  code: number | null;
  stdout: string;
  stderr: string;
  // True when stdout/stderr were capped to the host output ceiling.
  truncated: boolean;
}

export interface ConnectionExecOptions {
  // Piped to the process stdin (used to write file contents without shell redirection).
  input?: string;
  timeoutMs?: number;
  // Working directory to run the program in (container targets only — passed as `<engine> exec --workdir`). A
  // sandbox pins this to `/workspace` so the model's execCommand and relative paths resolve there.
  workdir?: string;
}

export interface ConnectionExecHost {
  // Run a program on the connection's host box. The transport (native spawn / wsl.exe / limactl / ssh …) is
  // chosen from the connection, so a *_REMOTE (SSH) connection runs the argv over its live SSH client.
  execOnConnection(
    connectionId: string,
    program: string,
    args: string[],
    opts?: ConnectionExecOptions,
  ): Promise<ConnectionExecResult>;
  // Captured `<engine> exec -i [--workdir] <containerId> <program> <args…>` on that connection (`-i` so a piped
  // `input` reaches the container process on stdin — without it the engine drops stdin and e.g. `tee` writes an
  // empty file; no `-t`, it stays non-interactive). A container on a *_REMOTE connection is therefore the
  // remote-container case, composed for free by the same transport.
  execInContainer(
    connectionId: string,
    containerId: string,
    program: string,
    args: string[],
    opts?: ConnectionExecOptions,
  ): Promise<ConnectionExecResult>;
  // Create a disposable, uniquely-named, labeled sandbox container from `image` on the connection, ready to exec
  // into (a long-lived entrypoint, `/workspace` working dir). Returns the created container id.
  createSandboxContainer(
    connectionId: string,
    image: string,
    opts: { runId: string; label: string },
  ): Promise<{ containerId: string }>;
  removeSandboxContainer(connectionId: string, containerId: string): Promise<void>;
}

// The per-target execution backend a worker runs against: its container-API ops, its confined workspace (file +
// command), the floor strictness for that target, and a teardown (sandbox removal; a no-op otherwise).
export interface ResolvedExecution {
  engineOps?: EngineOps;
  workspaceAccess?: IWorkspaceAccess;
  floorScope: FloorScope;
  dispose(): Promise<void>;
}

// Builds the backend for a worker's execution target. The run host calls this once per DISTINCT target within a
// run and shares the result across workers on the same target; `dispose` runs at run end.
export interface ExecutionSelector {
  select(target: WorkerExecutionTarget): Promise<ResolvedExecution>;
}

// A run-scoped ExecutionSelector factory: the run host builds one selector PER RUN (keyed off the run id) so a
// sandbox created for one run is never shared with — or disposed by — another. Injected by the shell root; absent
// on a shell with no off-host execution, where every worker falls back to the run-level host backend.
export type ExecutionSelectorFactory = (runId: string) => ExecutionSelector;
