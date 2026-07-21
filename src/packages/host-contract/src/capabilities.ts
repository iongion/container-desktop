import type { CommandExecutionResult } from "@/host-contract/exec";
// Privileged host capabilities — the SECOND interface tier, complementing the renderer-safe IHostRuntime
// (contract.ts). These are realm-local: a keychain that hands back plaintext secrets, an env-scrubbed
// executor, DNS, and the base process environment. They are NEVER re-aliased onto window.* / global.d.ts and
// never reach the renderer; a privileged consumer (the AI broker) is handed them in the realm that runs it —
// Electron main or the Tauri webview.
//
// This file is deliberately AI-free and imports nothing from @/ai-system, so ai-system can consume these
// ports without the platform↔AI type cycle that contract.ts (which imports @/ai-system/core) would create.
// Two impls per port live under platform/electron/capabilities and platform/tauri/capabilities.

// OS secret store (Electron safeStorage / Tauri keyring). Owns its own encrypted-at-rest storage — for the
// Electron impl that is a 0600 credentials file; the FS port is not used for secrets (it has no mode
// semantics). `getEncryptionStatus` is synchronous so the settings UI can read it without awaiting the vault.
export interface EncryptionStatus {
  available: boolean;
  backend?: string;
  // True when a stored secret would NOT be protected by a real OS secret store (unavailable, or the Linux
  // basic_text fallback). Consumers surface this and gate degraded writes behind explicit opt-in.
  degraded: boolean;
}

export interface IKeychain {
  getEncryptionStatus(): EncryptionStatus;
  hasKey(key: string): Promise<boolean>;
  getKey(key: string): Promise<string | undefined>;
  setKey(key: string, plaintext: string, opts?: { allowDegraded?: boolean }): Promise<void>;
  clearKey(key: string): Promise<void>;
}

export interface IsolatedExecOpts {
  cwd: string;
  env: Record<string, string>;
  timeout: number;
}

export type ExecuteIsolated = (
  program: string,
  args: string[],
  opts: IsolatedExecOpts,
) => Promise<CommandExecutionResult>;

// Hostname → resolved IPs, for the web-search SSRF guard (the guard rejects private/loopback addresses).
export type DnsResolve = (hostname: string) => Promise<string[]>;

// The base process environment a privileged consumer scrubs before an isolated exec. Electron main supplies
// process.env; the Tauri webview supplies an empty/minimal map (there is no ambient process env there).
export type HostEnv = Record<string, string | undefined>;

// The privileged bundle a host-side consumer (the AI broker) is assembled with. Never exposed on window.*.
export interface IHostCapabilities {
  keychain: IKeychain;
  executeIsolated: ExecuteIsolated;
  dns: DnsResolve;
  env: HostEnv;
}
