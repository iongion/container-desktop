// Electron (node, MAIN-only) implementation of the IWorkspaceAccess host port. The AI loop runs in Electron main,
// so this is a plain node:fs object — no IPC. It enforces workspace-root confinement HOST-SIDE (the security
// requirement): every path is lexically resolved against the root AND canonicalized with realpath so a `..` or a
// symlink cannot escape. Mutating ops are still gated by the session approval policy before the tool calls them.
// Imports no `electron` (it takes ExecuteIsolated as a dep), so it never risks entering the renderer bundle.

import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExecuteIsolated } from "@/host-contract/capabilities";
import type {
  IWorkspaceAccess,
  WorkspaceDirEntry,
  WorkspaceEditResult,
  WorkspaceEntryKind,
  WorkspaceExecResult,
  WorkspaceGrepMatch,
  WorkspaceGrepOptions,
  WorkspaceStat,
} from "@/host-contract/workspaceAccess";

export interface NodeWorkspaceAccessOptions {
  // Resolves the CURRENT workspace root each call (sourced from AI settings), so changing the folder takes effect
  // without rebuilding the capability. Empty/undefined ⇒ every op rejects with a "configure a workspace" error.
  resolveRoot: () => Promise<string | undefined> | string | undefined;
  // Isolated executor for exec(); its cwd is pinned to the confined workspace root.
  exec: ExecuteIsolated;
}

// Directories skipped by glob/grep walks — noise that would otherwise dominate results and blow the file budget.
const DEFAULT_IGNORES = new Set([".git", "node_modules"]);
const MAX_WALK_FILES = 20_000;
const MAX_GLOB_RESULTS = 1_000;
const DEFAULT_GREP_RESULTS = 200;
const HARD_MAX_GREP_RESULTS = 1_000;
const MAX_GREP_FILE_BYTES = 1_000_000;
const MAX_GREP_LINE_CHARS = 500;
const MAX_EXEC_OUTPUT_BYTES = 64 * 1024;
const EXEC_TIMEOUT_MS = 120_000;
// Only these process-env keys reach an exec'd command — enough for dev tools (PATH/HOME/…) without forwarding
// API keys or other secrets into a command the model chose.
const EXEC_ENV_ALLOWLIST = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ", "SHELL"];
// Cheap binary sniff: skip a file from grep if it contains a NUL byte. Built via String.fromCharCode so no NUL
// ever appears in source — pasting the raw byte itself would make Git treat this file as binary.
const NUL_BYTE = String.fromCharCode(0);

// Lexically resolve `requested` (workspace-relative) against `rootReal` and return the absolute path, or throw if
// it escapes the root. Pure (path math only) — the realpath/symlink guard is layered on top in the capability.
export function resolveWithinRoot(rootReal: string, requested: string): string {
  const abs = path.resolve(rootReal, requested);
  if (abs !== rootReal && !abs.startsWith(rootReal + path.sep)) {
    throw new Error(`Path escapes the workspace: ${requested}`);
  }
  return abs;
}

// Apply an in-place string edit. Without replaceAll, `oldString` must occur exactly once (unambiguous).
export function applyStringEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): { after: string; replacements: number } {
  if (oldString === "") throw new Error("editFile: oldString must not be empty");
  if (replaceAll) {
    const parts = content.split(oldString);
    const replacements = parts.length - 1;
    if (replacements === 0) throw new Error("editFile: oldString not found in the file");
    return { after: parts.join(newString), replacements };
  }
  const first = content.indexOf(oldString);
  if (first === -1) throw new Error("editFile: oldString not found in the file");
  if (content.indexOf(oldString, first + oldString.length) !== -1) {
    throw new Error("editFile: oldString is not unique; add surrounding context or set replaceAll");
  }
  return {
    after: content.slice(0, first) + newString + content.slice(first + oldString.length),
    replacements: 1,
  };
}

// Translate a glob (`*` within a segment, `**` across segments, `?` one non-slash char) into an anchored RegExp.
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*";
        i += 1;
        if (pattern[i + 1] === "/") i += 1;
      } else {
        source += "[^/]*";
      }
    } else if (c === "?") {
      source += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      source += `\\${c}`;
    } else {
      source += c;
    }
  }
  return new RegExp(`^${source}$`);
}

function entryKind(entry: Pick<Dirent, "isDirectory" | "isFile" | "isSymbolicLink">): WorkspaceEntryKind {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}

function statKind(stats: Stats): WorkspaceEntryKind {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "other";
}

function capOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXEC_OUTPUT_BYTES) return { text, truncated: false };
  return { text: text.slice(0, MAX_EXEC_OUTPUT_BYTES), truncated: true };
}

function execEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of EXEC_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export function createNodeWorkspaceAccess(options: NodeWorkspaceAccessOptions): IWorkspaceAccess {
  // The canonical (realpath'd) workspace root, or a clear error when none is configured.
  async function requireRoot(): Promise<string> {
    const raw = await options.resolveRoot();
    if (!raw?.trim()) {
      throw new Error("No workspace is configured. Choose a workspace folder in Settings → AI.");
    }
    return fs.realpath(raw);
  }

  async function realpathOrNull(target: string): Promise<string | null> {
    try {
      return await fs.realpath(target);
    } catch {
      return null;
    }
  }

  const isWithin = (root: string, target: string): boolean => target === root || target.startsWith(root + path.sep);

  // Lexical guard + realpath canonicalization: resolves symlinks and rejects any target (or, for a new path, any
  // existing ancestor) that resolves outside the root. This is where `..`/symlink escapes are stopped, host-side.
  async function canonicalize(root: string, requested: string, mustExist: boolean): Promise<string> {
    const abs = resolveWithinRoot(root, requested);
    const real = await realpathOrNull(abs);
    if (real !== null) {
      if (!isWithin(root, real)) throw new Error(`Path escapes the workspace: ${requested}`);
      return real;
    }
    if (mustExist) throw new Error(`Path not found in the workspace: ${requested}`);
    const parentReal = await realpathOrNull(path.dirname(abs));
    if (parentReal !== null && !isWithin(root, parentReal)) {
      throw new Error(`Path escapes the workspace: ${requested}`);
    }
    return abs;
  }

  async function* walkFiles(root: string): AsyncGenerator<string> {
    let count = 0;
    const stack: string[] = [""];
    while (stack.length > 0) {
      const relDir = stack.pop() as string;
      const absDir = relDir ? path.join(root, relDir) : root;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(absDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (DEFAULT_IGNORES.has(entry.name)) continue;
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          stack.push(rel);
        } else if (entry.isFile()) {
          count += 1;
          if (count > MAX_WALK_FILES) return;
          yield rel;
        }
      }
    }
  }

  return {
    async root() {
      return requireRoot();
    },
    async read(requested) {
      const root = await requireRoot();
      const abs = await canonicalize(root, requested, true);
      return fs.readFile(abs, "utf8");
    },
    async write(requested, contents) {
      const root = await requireRoot();
      const abs = await canonicalize(root, requested, false);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, contents, "utf8");
    },
    async edit(requested, oldString, newString, replaceAll): Promise<WorkspaceEditResult> {
      const root = await requireRoot();
      const abs = await canonicalize(root, requested, true);
      const before = await fs.readFile(abs, "utf8");
      const { after, replacements } = applyStringEdit(before, oldString, newString, replaceAll);
      await fs.writeFile(abs, after, "utf8");
      return { path: requested, before, after, replacements };
    },
    async list(requested): Promise<WorkspaceDirEntry[]> {
      const root = await requireRoot();
      const abs = await canonicalize(root, requested ?? ".", true);
      const entries = await fs.readdir(abs, { withFileTypes: true });
      return entries.map((entry) => ({ name: entry.name, kind: entryKind(entry) }));
    },
    async stat(requested): Promise<WorkspaceStat> {
      const root = await requireRoot();
      const abs = await canonicalize(root, requested, true);
      const stats = await fs.stat(abs);
      return { path: requested, kind: statKind(stats), size: stats.size, modifiedMs: stats.mtimeMs };
    },
    async remove(requested) {
      const root = await requireRoot();
      const abs = await canonicalize(root, requested, true);
      await fs.rm(abs, { recursive: true, force: false });
    },
    async glob(pattern) {
      const root = await requireRoot();
      const matcher = globToRegExp(pattern);
      const found: string[] = [];
      for await (const rel of walkFiles(root)) {
        if (matcher.test(rel)) {
          found.push(rel);
          if (found.length >= MAX_GLOB_RESULTS) break;
        }
      }
      return found;
    },
    async grep(pattern, options_?: WorkspaceGrepOptions): Promise<WorkspaceGrepMatch[]> {
      const root = await requireRoot();
      const matcher = new RegExp(pattern);
      const globMatcher = options_?.glob ? globToRegExp(options_.glob) : null;
      const limit = Math.min(options_?.maxResults ?? DEFAULT_GREP_RESULTS, HARD_MAX_GREP_RESULTS);
      const matches: WorkspaceGrepMatch[] = [];
      for await (const rel of walkFiles(root)) {
        if (globMatcher && !globMatcher.test(rel)) continue;
        let content: string;
        try {
          const abs = path.join(root, rel);
          const stats = await fs.stat(abs);
          if (stats.size > MAX_GREP_FILE_BYTES) continue;
          content = await fs.readFile(abs, "utf8");
        } catch {
          continue;
        }
        if (content.includes(NUL_BYTE)) continue;
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (matcher.test(lines[i])) {
            matches.push({ path: rel, line: i + 1, text: lines[i].slice(0, MAX_GREP_LINE_CHARS) });
            if (matches.length >= limit) return matches;
          }
        }
      }
      return matches;
    },
    async exec(program, args): Promise<WorkspaceExecResult> {
      const root = await requireRoot();
      const result = await options.exec(program, args, { cwd: root, env: execEnv(), timeout: EXEC_TIMEOUT_MS });
      const stdout = capOutput(result.stdout ?? "");
      const stderr = capOutput(result.stderr ?? "");
      return {
        program,
        args,
        code: typeof result.code === "number" ? result.code : null,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
      };
    },
  };
}
