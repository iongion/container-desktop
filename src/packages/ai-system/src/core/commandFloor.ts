// The catastrophic command FLOOR — pure decision logic, no node:/Electron/React.
//
// Enforced in "ask" + "remember", bypassed only in "always allow" (the user's explicit max-trust choice). A
// hardcoded denylist of destructive/privileged/shell/network programs, shell metacharacters in an argument, an
// invalid program token, or `..` traversal. Ordinary reads are user-gated (asked), NOT hard-blocked here.
//
// This lives in core (not the sandbox runtime) because BOTH the sandboxed runCommand path and the workspace
// tools' execCommand must apply it: the workspace exec runs a real program with the workspace as cwd,
// so it needs the same floor the sandbox has always had.

export interface FloorCommand {
  program: string;
  args: string[];
}

export interface FloorVerdict {
  blocked: boolean;
  reason?: string;
}

// A program name must be a bare executable token: no path separators, no metacharacters, no traversal.
const PROGRAM_RE = /^[a-z0-9][a-z0-9._+-]*$/i;

// Shell metacharacters. Commands run as an ARGS ARRAY (never a shell string), so these have no shell meaning
// here — their presence in a model token signals injection intent and has no legitimate use in our commands.
// Control chars (NUL, CR/LF, tab) are rejected too. NOTE: `{` and `}` are deliberately EXCLUDED — inert without
// a shell, and required for engine `--format '{{json .}}'` Go templates.
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

function hasTraversal(arg: string): boolean {
  return arg.split(/[\\/]/).some((seg) => seg === "..");
}

export function isFloorBlocked(cmd: FloorCommand): FloorVerdict {
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

// Apply the floor to a TYPED tool call by SHAPE rather than by name: any tool whose validated arguments carry a
// `program` string plus an `args` array is running a real process (today the workspace's execCommand), so
// it gets the same floor as the sandboxed runCommand. Structured tools (container ids, file paths) carry no
// program and are unaffected.
export function toolCommandFloorBlocked(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  const record = args as { program?: unknown; args?: unknown };
  if (typeof record.program !== "string") return false;
  return isFloorBlocked({ program: record.program, args: Array.isArray(record.args) ? (record.args as string[]) : [] })
    .blocked;
}
