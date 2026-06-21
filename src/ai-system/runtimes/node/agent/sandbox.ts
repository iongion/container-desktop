// Security-critical, MAIN-ONLY command sandbox for the assistant.
//
// The agent's tool API exposes ONLY `{ program, args }` — the model can set neither a shell nor any
// process option. The run/ask/reject permission decision is made UPSTREAM (the tool gate, by the user's
// mode); this module is the structural boundary: it enforces a narrow catastrophic FLOOR (denylist +
// shell-metacharacters + `..` traversal — bypassed only in "always allow") and, when running, builds the
// process options ITSELF (fixed cwd, scrubbed env, hard timeout, NO shell / detached / wrapper /
// model-supplied cwd|env) before handing an ARGS ARRAY (never a shell string) to an injected executor.
// Output is capped and redacted before it can re-enter the model.

import os from "node:os";
import type { SandboxCommand, SandboxExecResult } from "@/ai-system/core";
import { redactText } from "@/ai-system/core";
import type { CommandExecutionResult } from "@/env/Types";

// SandboxCommand / SandboxExecResult are OWNED by core (ports.ts). Re-export them so existing
// "./sandbox" importers keep working AND there is a single source of truth — no local copy can drift.
export type { SandboxCommand, SandboxExecResult };

// A program name must be a bare executable token: no path separators, no metacharacters, no traversal.
const PROGRAM_RE = /^[a-z0-9][a-z0-9._+-]*$/i;

// Shell metacharacters. Commands run as an ARGS ARRAY (never a shell string), so these have no shell
// meaning here — their presence in a model token signals injection intent and has no legitimate use in
// our commands. Control chars (NUL, CR/LF, tab) are rejected too. NOTE: `{` and `}` are deliberately
// EXCLUDED — inert without a shell, and required for engine `--format '{{json .}}'` Go templates.
const META_RE = /[;&|<>$`()[\]!*?~\n\r\t\0\\"']/;

// Programs that may NEVER run in ask/remember mode, regardless of arguments (the catastrophic floor).
const BANNED_PROGRAMS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "sudo",
  "su",
  "doas",
  "pkexec",
  "dd",
  "mkfs",
  "fdisk",
  "parted",
  "mkswap",
  "eval",
  "exec",
  "source",
  "bash",
  "sh",
  "zsh",
  "fish",
  "ksh",
  "csh",
  "ash",
  "dash",
  "pwsh",
  "powershell",
  "cmd",
  "chmod",
  "chown",
  "chgrp",
  "setfacl",
  "kill",
  "killall",
  "pkill",
  "reboot",
  "shutdown",
  "halt",
  "poweroff",
  "init",
  "telinit",
  "systemctl",
  "mount",
  "umount",
  "curl",
  "wget",
  "nc",
  "ncat",
  "netcat",
  "telnet",
  "ssh",
  "scp",
  "sftp",
  "ftp",
  "rsync",
]);

function isBannedProgram(program: string): boolean {
  return BANNED_PROGRAMS.has(program) || /^mkfs\./i.test(program);
}

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

export interface SandboxExecOpts {
  cwd: string;
  env: Record<string, string>;
  timeout: number;
}

export type SandboxExec = (program: string, args: string[], opts: SandboxExecOpts) => Promise<CommandExecutionResult>;

export interface ExecuteDeps {
  exec: SandboxExec;
  baseEnv?: NodeJS.ProcessEnv;
  cwd?: string;
  maxOutputBytes?: number;
  timeoutMs?: number;
  // When false ("always allow" mode), the floor is NOT enforced — anything runs. Default true.
  enforceFloor?: boolean;
}

function hasTraversal(arg: string): boolean {
  return arg.split(/[\\/]/).some((seg) => seg === "..");
}

// The catastrophic FLOOR — enforced in "ask" + "remember", bypassed in "always allow". A hardcoded denylist
// of destructive/privileged/shell/network programs, shell metacharacters in an arg, an invalid program
// token, or `..` traversal. Ordinary reads are user-gated (asked), NOT hard-blocked here.
export function isFloorBlocked(cmd: SandboxCommand): { blocked: boolean; reason?: string } {
  const program = cmd?.program;
  const args = cmd?.args;
  if (typeof program !== "string" || program.length === 0 || !PROGRAM_RE.test(program)) {
    return { blocked: true, reason: "invalid program name" };
  }
  if (isBannedProgram(program)) {
    return { blocked: true, reason: `blocked program: ${program}` };
  }
  if (!Array.isArray(args)) {
    return { blocked: true, reason: "invalid arguments" };
  }
  for (const a of args) {
    if (typeof a !== "string") {
      return { blocked: true, reason: "non-string argument" };
    }
    if (META_RE.test(a)) {
      return { blocked: true, reason: "shell metacharacter in argument" };
    }
    if (hasTraversal(a)) {
      return { blocked: true, reason: "path traversal in argument" };
    }
  }
  return { blocked: false };
}

// Build the scrubbed child environment from an allowlist of variable names.
function scrubEnv(base: NodeJS.ProcessEnv): Record<string, string> {
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
  const baseEnv = deps.baseEnv ?? process.env;
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
    cwd: deps.cwd ?? os.tmpdir(),
    env: scrubEnv(baseEnv),
    timeout: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  let result: CommandExecutionResult;
  try {
    result = await deps.exec(cmd.program, cmd.args, opts);
  } catch (error: any) {
    return {
      ok: false,
      tier: "error",
      reason: "",
      stdout: "",
      stderr: redactText(String(error?.message ?? error)),
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
