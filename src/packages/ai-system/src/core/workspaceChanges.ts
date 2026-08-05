import type { ExecutionTarget } from "./executionTargets";
import { executionTargetKey } from "./executionTargets";
import { redactText } from "./redact";

export type WorkspaceChangeState =
  | "unchanged"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "conflicted"
  | "untracked";

export interface WorkspaceChangeEntry {
  path: string;
  previousPath?: string;
  index: WorkspaceChangeState;
  worktree: WorkspaceChangeState;
}

// WHERE a change set was read, which is not an execution target: the exec is injected, and the app reads its own
// workspace directly. `app` is that case — the folder as this app sees it — while a container or sandbox origin says
// the status came from inside the one the session chose.
export type WorkspaceChangeOrigin = { kind: "app" } | ExecutionTarget;

// One stable key per origin, so two snapshots are only compared when they were read from the same place.
function originKey(origin: WorkspaceChangeOrigin): string {
  return origin.kind === "app" ? "app" : executionTargetKey(origin);
}

interface WorkspaceChangeLocation {
  origin: WorkspaceChangeOrigin;
  workspaceRoot: string;
}

export type WorkspaceChangeSnapshot =
  | (WorkspaceChangeLocation & {
      state: "clean" | "changes";
      branch?: string;
      head?: string;
      entries: WorkspaceChangeEntry[];
      fingerprint: string;
      truncated: boolean;
    })
  | (WorkspaceChangeLocation & {
      state: "not-repository" | "unavailable";
      entries: [];
      truncated: boolean;
      message: string;
    });

export type WorkspaceDiff =
  | (WorkspaceChangeLocation & {
      state: "clean" | "changes";
      staged: string;
      unstaged: string;
      untracked: string[];
      truncated: boolean;
    })
  | (WorkspaceChangeLocation & {
      state: "not-repository" | "unavailable";
      truncated: boolean;
      message: string;
    });

export interface WorkspaceChangeSummary extends WorkspaceChangeLocation {
  beforeCount: number;
  afterCount: number;
  introduced: string[];
  cleared: string[];
  updated: string[];
  contentChanged: boolean;
  truncated: boolean;
}

export interface WorkspaceChangesPort {
  status(): Promise<WorkspaceChangeSnapshot>;
  diff(): Promise<WorkspaceDiff>;
}

interface WorkspaceChangesExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export type WorkspaceChangesExec = (
  workspaceRoot: string,
  program: "git",
  args: readonly string[],
) => Promise<WorkspaceChangesExecResult>;

export interface WorkspaceChangesPortOptions {
  origin: WorkspaceChangeOrigin;
  workspaceRoot: () => Promise<string>;
  exec: WorkspaceChangesExec;
  fingerprint: (text: string) => Promise<string>;
  untrackedSignature?: (path: string) => Promise<string>;
}

const MAX_CHANGE_ENTRIES = 500;
const MAX_PATH_CHARS = 1_024;
const MAX_DIFF_CHARS = 128 * 1_024;
const GIT_PREFIX = [
  "-c",
  "color.ui=false",
  "-c",
  "core.quotepath=false",
  "-c",
  "status.relativePaths=true",
  "-c",
  "core.fsmonitor=false",
  "--no-pager",
] as const;
const STATUS_ARGS = [
  ...GIT_PREFIX,
  "status",
  "--porcelain=v2",
  "--branch",
  "-z",
  "--untracked-files=all",
  "--ignore-submodules=all",
  "--",
  ".",
] as const;
const DIFF_ARGS = [
  ...GIT_PREFIX,
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--ignore-submodules=all",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--",
  ".",
] as const;
const STAGED_DIFF_ARGS = [...GIT_PREFIX, "diff", "--cached", ...DIFF_ARGS.slice(GIT_PREFIX.length + 1)] as const;

function splitFields(record: string, pathIndex: number): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let index = 0; index < pathIndex; index += 1) {
    const separator = record.indexOf(" ", start);
    if (separator < 0) return [];
    fields.push(record.slice(start, separator));
    start = separator + 1;
  }
  fields.push(record.slice(start));
  return fields;
}

function validRelativePath(path: string): boolean {
  if (!path || path.length > MAX_PATH_CHARS || path.startsWith("/") || /^[a-z]:[/\\]/iu.test(path)) return false;
  return !path.split(/[/\\]/u).some((part) => part === "..");
}

function stateFor(code: string): WorkspaceChangeState {
  switch (code) {
    case ".":
      return "unchanged";
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "conflicted";
    case "?":
      return "untracked";
    default:
      return "conflicted";
  }
}

function trackedEntry(record: string, pathIndex: number): WorkspaceChangeEntry | undefined {
  const fields = splitFields(record, pathIndex);
  const status = fields[1];
  const path = fields[pathIndex];
  if (status?.length !== 2 || !validRelativePath(path)) return undefined;
  return { path: redactText(path), index: stateFor(status[0]), worktree: stateFor(status[1]) };
}

interface ParsedGitStatus {
  branch?: string;
  head?: string;
  entries: WorkspaceChangeEntry[];
  rejectedPaths: number;
}

export function parseGitStatus(raw: string): ParsedGitStatus {
  const records = raw.split("\u0000");
  const entries: WorkspaceChangeEntry[] = [];
  let branch: string | undefined;
  let head: string | undefined;
  let rejectedPaths = 0;

  for (let cursor = 0; cursor < records.length; cursor += 1) {
    const record = records[cursor];
    if (record.startsWith("# branch.head ")) {
      branch = redactText(record.slice("# branch.head ".length));
    } else if (record.startsWith("# branch.oid ")) {
      head = record.slice("# branch.oid ".length, "# branch.oid ".length + 64);
    } else if (record.startsWith("1 ")) {
      const entry = trackedEntry(record, 8);
      if (entry) entries.push(entry);
      else rejectedPaths += 1;
    } else if (record.startsWith("2 ")) {
      const entry = trackedEntry(record, 9);
      const previousPath = records[cursor + 1];
      if (entry && validRelativePath(previousPath)) {
        entries.push({ ...entry, previousPath: redactText(previousPath) });
      } else {
        rejectedPaths += 1;
      }
      cursor += 1;
    } else if (record.startsWith("u ")) {
      const entry = trackedEntry(record, 10);
      if (entry) entries.push({ ...entry, index: "conflicted", worktree: "conflicted" });
      else rejectedPaths += 1;
    } else if (record.startsWith("? ")) {
      const path = record.slice(2);
      if (validRelativePath(path)) entries.push({ path: redactText(path), index: "untracked", worktree: "untracked" });
      else rejectedPaths += 1;
    }
  }

  return { ...(branch ? { branch } : {}), ...(head ? { head } : {}), entries, rejectedPaths };
}

function failure(
  location: WorkspaceChangeLocation,
  result: WorkspaceChangesExecResult,
): Extract<WorkspaceChangeSnapshot, { state: "not-repository" | "unavailable" }> {
  if (/not a git repository/iu.test(result.stderr)) {
    return {
      ...location,
      state: "not-repository",
      entries: [],
      truncated: result.truncated,
      message: "Not a Git repository",
    };
  }
  return {
    ...location,
    state: "unavailable",
    entries: [],
    truncated: result.truncated,
    message: redactText(result.stderr.trim() || "Git changes are unavailable"),
  };
}

function capPatch(text: string): { text: string; truncated: boolean } {
  const redacted = redactText(text);
  return {
    text: redacted.slice(0, MAX_DIFF_CHARS),
    truncated: redacted.length > MAX_DIFF_CHARS,
  };
}

export function createWorkspaceChangesPort(options: WorkspaceChangesPortOptions): WorkspaceChangesPort {
  async function inspect() {
    const workspaceRoot = await options.workspaceRoot();
    const location = { origin: options.origin, workspaceRoot };
    const status = await options.exec(workspaceRoot, "git", STATUS_ARGS);
    if (status.code !== 0) return { location, failure: failure(location, status) };
    const [unstaged, staged] = await Promise.all([
      options.exec(workspaceRoot, "git", DIFF_ARGS),
      options.exec(workspaceRoot, "git", STAGED_DIFF_ARGS),
    ]);
    if (unstaged.code !== 0) return { location, failure: failure(location, unstaged) };
    if (staged.code !== 0) return { location, failure: failure(location, staged) };
    return { location, status, unstaged, staged, parsed: parseGitStatus(status.stdout) };
  }

  return {
    async status() {
      const inspected = await inspect();
      if (inspected.failure) return inspected.failure;
      const { location, status, unstaged, staged, parsed } = inspected;
      const retained = parsed.entries.slice(0, MAX_CHANGE_ENTRIES);
      const untrackedSignatures = options.untrackedSignature
        ? await Promise.all(
            retained
              .filter(({ index }) => index === "untracked")
              .map(async ({ path }) => options.untrackedSignature?.(path).catch(() => "unavailable")),
          )
        : [];
      const fingerprint = await options.fingerprint(
        [status.stdout, unstaged.stdout, staged.stdout, ...untrackedSignatures].join("\u0000"),
      );
      return {
        ...location,
        state: parsed.entries.length ? "changes" : "clean",
        ...(parsed.branch ? { branch: parsed.branch } : {}),
        ...(parsed.head ? { head: parsed.head } : {}),
        entries: retained,
        fingerprint,
        truncated:
          status.truncated ||
          unstaged.truncated ||
          staged.truncated ||
          parsed.rejectedPaths > 0 ||
          parsed.entries.length > MAX_CHANGE_ENTRIES,
      };
    },
    async diff() {
      const inspected = await inspect();
      if (inspected.failure) {
        const { entries: _, ...diffFailure } = inspected.failure;
        return diffFailure;
      }
      const { location, status, unstaged, staged, parsed } = inspected;
      const unstagedPatch = capPatch(unstaged.stdout);
      const stagedPatch = capPatch(staged.stdout);
      const untracked = parsed.entries
        .filter(({ index }) => index === "untracked")
        .map(({ path }) => path)
        .slice(0, MAX_CHANGE_ENTRIES);
      return {
        ...location,
        state: parsed.entries.length ? "changes" : "clean",
        staged: stagedPatch.text,
        unstaged: unstagedPatch.text,
        untracked,
        truncated:
          status.truncated ||
          unstaged.truncated ||
          staged.truncated ||
          unstagedPatch.truncated ||
          stagedPatch.truncated ||
          parsed.rejectedPaths > 0 ||
          parsed.entries.length > MAX_CHANGE_ENTRIES,
      };
    },
  };
}

function entryState(entry: WorkspaceChangeEntry): string {
  return `${entry.index}:${entry.worktree}:${entry.previousPath ?? ""}`;
}

type ComparableWorkspaceChangeSnapshot = Extract<WorkspaceChangeSnapshot, { state: "clean" | "changes" }>;

function isComparable(snapshot: WorkspaceChangeSnapshot): snapshot is ComparableWorkspaceChangeSnapshot {
  return snapshot.state === "clean" || snapshot.state === "changes";
}

export function summarizeWorkspaceChanges(
  before: WorkspaceChangeSnapshot,
  after: WorkspaceChangeSnapshot,
): WorkspaceChangeSummary | undefined {
  if (
    !isComparable(before) ||
    !isComparable(after) ||
    before.workspaceRoot !== after.workspaceRoot ||
    originKey(before.origin) !== originKey(after.origin) ||
    before.fingerprint === after.fingerprint
  ) {
    return undefined;
  }
  const beforeByPath = new Map(before.entries.map((entry) => [entry.path, entry] as const));
  const afterByPath = new Map(after.entries.map((entry) => [entry.path, entry] as const));
  const introduced = after.entries.filter(({ path }) => !beforeByPath.has(path)).map(({ path }) => path);
  const cleared = before.entries.filter(({ path }) => !afterByPath.has(path)).map(({ path }) => path);
  const updated = after.entries
    .filter((entry) => {
      const previous = beforeByPath.get(entry.path);
      return previous && entryState(previous) !== entryState(entry);
    })
    .map(({ path }) => path);
  return {
    origin: after.origin,
    workspaceRoot: after.workspaceRoot,
    beforeCount: before.entries.length,
    afterCount: after.entries.length,
    introduced,
    cleared,
    updated,
    contentChanged: introduced.length === 0 && cleared.length === 0 && updated.length === 0,
    truncated: before.truncated || after.truncated,
  };
}
