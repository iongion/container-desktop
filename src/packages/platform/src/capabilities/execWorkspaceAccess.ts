// Exec-routed IWorkspaceAccess (MAIN). The in-container twin of createNodeWorkspaceAccess: instead of node:fs it
// drives the target container through ONE injected captured-exec primitive, so a session's file + command tools
// act on a directory that lives WHERE THE SESSION RUNS. File ops use portable, shell-free
// argv (cat / tee-via-stdin / find / grep / stat / rm / mkdir) with ABSOLUTE target paths, so they are
// cwd-independent; the model's execCommand runs through the same primitive (its cwd is the target's — a sandbox
// pins /workspace at creation). Confinement is POSIX-lexical against the target root (targets are unix-like):
// `..` and absolute escapes are rejected before any argv is built.

import type { ConnectionExecResult } from "@/ai-system/core/ports";
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
import { applyStringEdit, globToRegExp, posixDirname, posixRelative, posixResolve } from "./workspaceTextOps";

// The bound, target-scoped exec primitive: run one argv on the target (optionally piping `input` to stdin).
export type TargetExec = (program: string, args: string[], opts?: { input?: string }) => Promise<ConnectionExecResult>;

export interface ExecWorkspaceAccessOptions {
  // Absolute path of the workspace root ON THE TARGET (e.g. "/workspace"). Every file op is confined under it.
  root: string;
  exec: TargetExec;
}

const MAX_GLOB_RESULTS = 1_000;
const DEFAULT_GREP_RESULTS = 200;
const HARD_MAX_GREP_RESULTS = 1_000;
const MAX_GREP_LINE_CHARS = 500;
const IGNORED_SEGMENTS = new Set([".git", "node_modules"]);

// Lexically resolve a workspace-relative path against the POSIX target root; reject `..`/absolute escapes.
export function resolvePosixWithinRoot(root: string, requested: string): string {
  const abs = posixResolve(root, requested);
  if (abs !== root && !abs.startsWith(`${root}/`)) {
    throw new Error(`Path escapes the workspace: ${requested}`);
  }
  return abs;
}

function toRelative(root: string, abs: string): string {
  const rel = posixRelative(root, abs);
  return rel;
}

function isIgnored(rel: string): boolean {
  return rel.split("/").some((seg) => IGNORED_SEGMENTS.has(seg));
}

// Handles BOTH stat dialects' type words: GNU `%F` → "directory"/"regular file"/"symbolic link";
// BSD `%HT` → "Directory"/"Regular File"/"Symbolic Link". Lowercased so the same matches cover both.
function statKindFromDescription(description: string): WorkspaceEntryKind {
  const lower = description.toLowerCase();
  if (lower.includes("directory")) return "directory";
  if (lower.includes("symbolic link")) return "symlink";
  if (lower.includes("regular")) return "file";
  return "other";
}

// GNU coreutils and BSD/macOS `stat` are mutually incompatible: GNU takes `-c <fmt>` with `%s %Y %F`, BSD takes
// `-f <fmt>` with `%z %m %HT`. Both emit "<size> <mtimeEpoch> <type>" in that order, so parsing is shared; only
// the invocation differs. A remote worker target can be either OS and the selector does not know which, so the
// dialect is discovered at runtime (try GNU, fall back to BSD) and cached per workspace after the first success.
type StatDialect = "gnu" | "bsd";
const STAT_ARGS: Record<StatDialect, (abs: string) => string[]> = {
  gnu: (abs) => ["-c", "%s %Y %F", abs],
  bsd: (abs) => ["-f", "%z %m %HT", abs],
};

export function createExecWorkspaceAccess(options: ExecWorkspaceAccessOptions): IWorkspaceAccess {
  const { root, exec } = options;
  // The stat dialect that last worked on this target, so subsequent stats skip the failing probe.
  let statDialect: StatDialect | undefined;

  async function run(program: string, args: string[], input?: string): Promise<ConnectionExecResult> {
    return exec(program, args, input !== undefined ? { input } : undefined);
  }

  async function readFile(abs: string): Promise<string> {
    const result = await run("cat", [abs]);
    if (result.code !== 0) throw new Error(`Path not found in the workspace: ${abs}`);
    return result.stdout;
  }

  async function writeFile(abs: string, contents: string): Promise<void> {
    const dir = posixDirname(abs);
    await run("mkdir", ["-p", dir]);
    // tee writes stdin to the file (and echoes to stdout, which we ignore) — no shell redirection.
    const result = await run("tee", [abs], contents);
    if (result.code !== 0) throw new Error(`Unable to write ${abs}: ${result.stderr}`);
  }

  async function statFile(requested: string): Promise<WorkspaceStat> {
    const abs = resolvePosixWithinRoot(root, requested);
    const order: StatDialect[] = statDialect === "bsd" ? ["bsd", "gnu"] : ["gnu", "bsd"];
    for (const dialect of order) {
      const result = await run("stat", STAT_ARGS[dialect](abs));
      if (result.code !== 0) continue;
      statDialect = dialect;
      const [sizeText, mtimeText, ...rest] = result.stdout.trim().split(/\s+/);
      return {
        path: requested,
        kind: statKindFromDescription(rest.join(" ")),
        size: Number.parseInt(sizeText, 10) || 0,
        modifiedMs: (Number.parseInt(mtimeText, 10) || 0) * 1000,
      };
    }
    throw new Error(`Path not found in the workspace: ${requested}`);
  }

  return {
    async root() {
      return root;
    },

    async read(requested) {
      return readFile(resolvePosixWithinRoot(root, requested));
    },

    async write(requested, contents) {
      await writeFile(resolvePosixWithinRoot(root, requested), contents);
    },

    async writeNew(requested, contents) {
      const abs = resolvePosixWithinRoot(root, requested);
      const dir = posixDirname(abs);
      const mkdir = await run("mkdir", ["-p", dir]);
      if (mkdir.code !== 0) throw new Error(`Unable to create ${dir}: ${mkdir.stderr}`);
      const temporary = await run("mktemp", [`${dir}/.container-desktop-new.XXXXXX`]);
      const tempPath = temporary.stdout.trim();
      if (
        temporary.code !== 0 ||
        !tempPath.startsWith(`${dir}/.container-desktop-new.`) ||
        posixDirname(tempPath) !== dir
      ) {
        throw new Error(`Unable to create a temporary file in ${dir}: ${temporary.stderr}`);
      }
      try {
        const written = await run("tee", [tempPath], contents);
        if (written.code !== 0) throw new Error(`Unable to write ${requested}: ${written.stderr}`);
        const linked = await run("ln", [tempPath, abs]);
        if (linked.code === 0) return "created";
        try {
          await statFile(requested);
          return "exists";
        } catch {
          throw new Error(`Unable to create ${requested}: ${linked.stderr}`);
        }
      } finally {
        await run("rm", ["-f", tempPath]);
      }
    },

    async edit(requested, oldString, newString, replaceAll): Promise<WorkspaceEditResult> {
      const abs = resolvePosixWithinRoot(root, requested);
      const before = await readFile(abs);
      const { after, replacements } = applyStringEdit(before, oldString, newString, replaceAll);
      await writeFile(abs, after);
      return { path: requested, before, after, replacements };
    },

    async list(requested): Promise<WorkspaceDirEntry[]> {
      const abs = resolvePosixWithinRoot(root, requested ?? ".");
      // `-1Ap`: one per line, include dotfiles (not . / ..), append `/` to directories.
      const result = await run("ls", ["-1Ap", abs]);
      if (result.code !== 0) throw new Error(`Path not found in the workspace: ${requested ?? "."}`);
      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((name) =>
          name.endsWith("/")
            ? ({ name: name.slice(0, -1), kind: "directory" } as WorkspaceDirEntry)
            : ({ name, kind: "file" } as WorkspaceDirEntry),
        );
    },

    stat: statFile,

    async remove(requested) {
      const abs = resolvePosixWithinRoot(root, requested);
      const result = await run("rm", ["-r", abs]);
      if (result.code !== 0) throw new Error(`Unable to remove ${requested}: ${result.stderr}`);
    },

    async glob(pattern): Promise<string[]> {
      const matcher = globToRegExp(pattern);
      const result = await run("find", [root, "-type", "f"]);
      const found: string[] = [];
      for (const line of result.stdout.split("\n")) {
        const abs = line.trim();
        if (!abs) continue;
        const rel = toRelative(root, abs);
        if (!rel || isIgnored(rel)) continue;
        if (matcher.test(rel)) {
          found.push(rel);
          if (found.length >= MAX_GLOB_RESULTS) break;
        }
      }
      return found;
    },

    async grep(pattern, options_?: WorkspaceGrepOptions): Promise<WorkspaceGrepMatch[]> {
      const globMatcher = options_?.glob ? globToRegExp(options_.glob) : null;
      const limit = Math.min(options_?.maxResults ?? DEFAULT_GREP_RESULTS, HARD_MAX_GREP_RESULTS);
      // grep exit code 1 = "no matches" (not an error); >1 is a real failure.
      const result = await run("grep", ["-rnIE", "--", pattern, root]);
      if (result.code !== 0 && result.code !== 1) {
        throw new Error(`grep failed: ${result.stderr}`);
      }
      const matches: WorkspaceGrepMatch[] = [];
      for (const line of result.stdout.split("\n")) {
        if (!line) continue;
        const firstColon = line.indexOf(":");
        const secondColon = line.indexOf(":", firstColon + 1);
        if (firstColon < 0 || secondColon < 0) continue;
        const rel = toRelative(root, line.slice(0, firstColon));
        if (!rel || isIgnored(rel)) continue;
        if (globMatcher && !globMatcher.test(rel)) continue;
        const lineNo = Number.parseInt(line.slice(firstColon + 1, secondColon), 10);
        if (!Number.isFinite(lineNo)) continue;
        matches.push({ path: rel, line: lineNo, text: line.slice(secondColon + 1).slice(0, MAX_GREP_LINE_CHARS) });
        if (matches.length >= limit) break;
      }
      return matches;
    },

    async exec(program, args): Promise<WorkspaceExecResult> {
      const result = await run(program, args);
      return {
        program,
        args,
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
      };
    },
  };
}
