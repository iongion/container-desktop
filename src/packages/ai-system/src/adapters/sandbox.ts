import type { CommandExecutionResult } from "@/host-contract/exec";
// Security-critical, MAIN-ONLY command sandbox for the assistant.
//
// The agent's tool API exposes ONLY `{ program, args }` — the model can set neither a shell nor any
// process option. The run/ask/reject permission decision is made UPSTREAM (the tool gate, by the user's
// mode); this module is the structural boundary: it enforces a narrow catastrophic FLOOR (denylist +
// shell-metacharacters + `..` traversal — bypassed only in "always allow") and, when running, builds the
// process options ITSELF (fixed cwd, scrubbed env, hard timeout, NO shell / detached / wrapper /
// model-supplied cwd|env) before handing an ARGS ARRAY (never a shell string) to an injected executor.
// Output is capped and redacted before it can re-enter the model.

import { isFloorBlocked } from "@/ai-system/core/commandFloor";
import type { SandboxCommand, SandboxExecResult } from "@/ai-system/core/ports";
import { redactText } from "@/ai-system/core/redact";

import type { ExecuteIsolated, HostEnv, IsolatedExecOpts } from "@/host-contract/capabilities";

// Environment variables a sandboxed child may see. Everything else (tokens, cloud creds, etc.) is
// dropped — an allowlist, not a denylist, so a new secret-bearing variable can't silently leak.
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TZ",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "DBUS_SESSION_BUS_ADDRESS",
  // Windows
  "SystemRoot",
  "windir",
  "PATHEXT",
  "ComSpec",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
];

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

// The sandbox executor IS the generic host ExecuteIsolated port; these aliases keep the sandbox-policy-facing
// names (and every "./sandbox" importer) stable while the single source of truth lives in platform/capabilities.
export type SandboxExecOpts = IsolatedExecOpts;
export type SandboxExec = ExecuteIsolated;

export interface ExecuteDeps {
  exec: SandboxExec;
  baseEnv?: HostEnv;
  cwd?: string;
  maxOutputBytes?: number;
  timeoutMs?: number;
  // When false ("always allow" mode), the floor is NOT enforced — anything runs. Default true.
  enforceFloor?: boolean;
}

// Build the scrubbed child environment from an allowlist of variable names.
function scrubEnv(base: HostEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = base[key];
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

// Redact secrets FIRST (so full-length tokens are matched), then cap length.
function capAndRedact(text: string, max: number): { text: string; truncated: boolean } {
  const redacted = redactText(text ?? "");
  if (redacted.length > max) {
    return { text: `${redacted.slice(0, max)}\n…[truncated]`, truncated: true };
  }
  return { text: redacted, truncated: false };
}

// Enforce the floor (defense-in-depth — never trust the caller) unless the caller is in "always allow"
// (enforceFloor:false), then run with sandbox-owned process options and capped, redacted output. The
// run/ask/reject permission decision is made upstream (the tool gate); this is the last structural guard.
export async function executeSandboxed(cmd: SandboxCommand, deps: ExecuteDeps): Promise<SandboxExecResult> {
  // The base env is INJECTED (createAISystem passes the host's env capability); default to empty so this neutral
  // policy never reaches for process.env (which is absent in the Tauri webview anyway).
  const baseEnv = deps.baseEnv ?? {};
  if (deps.enforceFloor !== false) {
    const floor = isFloorBlocked(cmd);
    if (floor.blocked) {
      return {
        ok: false,
        tier: "blocked",
        reason: floor.reason ?? "blocked",
        stdout: "",
        stderr: "",
        code: null,
        truncated: false,
        rejectedReason: floor.reason,
      };
    }
  }

  const opts: SandboxExecOpts = {
    cwd: deps.cwd ?? ".",
    env: scrubEnv(baseEnv),
    timeout: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  let result: CommandExecutionResult;
  try {
    result = await deps.exec(cmd.program, cmd.args, opts);
  } catch (error) {
    return {
      ok: false,
      tier: "error",
      reason: "",
      stdout: "",
      stderr: redactText(error instanceof Error ? error.message : String(error)),
      code: null,
      truncated: false,
    };
  }

  const max = deps.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const out = capAndRedact(result.stdout ?? "", max);
  const err = capAndRedact(result.stderr ?? "", max);
  return {
    ok: result.success !== false,
    tier: "ran",
    reason: "",
    stdout: out.text,
    stderr: err.text,
    code: typeof result.code === "number" ? result.code : null,
    truncated: out.truncated || err.truncated,
  };
}
