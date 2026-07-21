// Workspace-access host PORT — the AI assistant's confined view of ONE project directory on disk. Part of the
// AI-free host-contract leaf (alongside fs.ts / exec.ts); imports nothing internal so the assistant runtime and the platform
// shells can consume it without a cycle. platform IMPLEMENTS it (Electron node / Tauri Rust / Wails Go).
//
// SECURITY (non-negotiable): the HOST implementation MUST enforce workspace-root confinement — canonicalize
// every path and reject `..` / symlink escapes INSIDE the capability, never in the JS tool layer that calls it.
// `path` arguments are workspace-relative; returned paths are workspace-relative too. File contents and command
// output are UNTRUSTED (a prompt-injection surface). Mutating ops (write/edit/remove/exec) are gated by the
// session approval policy before the tool invokes them. All methods are async, mirroring IFileSystem.

export type WorkspaceEntryKind = "file" | "directory" | "symlink" | "other";

export interface WorkspaceDirEntry {
  name: string;
  kind: WorkspaceEntryKind;
}

export interface WorkspaceStat {
  // Workspace-relative path of the entry that was stat-ed.
  path: string;
  kind: WorkspaceEntryKind;
  // Size in bytes (0 for directories).
  size: number;
  // Last-modified time, epoch milliseconds.
  modifiedMs: number;
}

export interface WorkspaceEditResult {
  // Workspace-relative path of the edited file.
  path: string;
  // Full file content before and after the edit — the diff card renders the change from these.
  before: string;
  after: string;
  // How many occurrences of `oldString` were replaced.
  replacements: number;
}

export interface WorkspaceGrepMatch {
  // Workspace-relative path of the file the match was found in.
  path: string;
  // 1-based line number.
  line: number;
  // The matching line, already length-capped by the host.
  text: string;
}

export interface WorkspaceGrepOptions {
  // Restrict the search to files whose workspace-relative path matches this glob.
  glob?: string;
  // Cap the number of matches returned (the host also applies a hard ceiling).
  maxResults?: number;
}

export interface WorkspaceExecResult {
  program: string;
  args: string[];
  // Process exit code, or null if it was terminated by a signal.
  code: number | null;
  stdout: string;
  stderr: string;
  // True when stdout/stderr were truncated to the host output cap.
  truncated: boolean;
}

export interface IWorkspaceAccess {
  // Absolute, canonicalized workspace root, for display in the UI. Rejects if no root is configured.
  root(): Promise<string>;
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  // In-place edit: replace occurrences of `oldString` with `newString`. When `replaceAll` is false (the
  // default) `oldString` must occur EXACTLY once, so the edit is unambiguous. Returns before/after for a diff.
  edit(path: string, oldString: string, newString: string, replaceAll?: boolean): Promise<WorkspaceEditResult>;
  // Directory listing of `path` (workspace root when omitted).
  list(path?: string): Promise<WorkspaceDirEntry[]>;
  stat(path: string): Promise<WorkspaceStat>;
  remove(path: string): Promise<void>;
  // Files whose workspace-relative path matches the glob (`*`, `**`, `?` supported).
  glob(pattern: string): Promise<string[]>;
  // Lines matching the regular-expression `pattern` across the workspace.
  grep(pattern: string, options?: WorkspaceGrepOptions): Promise<WorkspaceGrepMatch[]>;
  // Run a program with its working directory pinned to the workspace root.
  exec(program: string, args: string[]): Promise<WorkspaceExecResult>;
}
