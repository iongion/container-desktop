// VirtualEngineHost — an in-memory ConnectionExecHost for tests AND the CONTAINER_DESKTOP_MOCK app. It is the
// mock twin of the real platform connectionExec adapter: instead of spawning podman/docker it models a container
// registry over per-target virtual filesystems and EMULATES the exact POSIX argv the worker's exec-routed
// workspace emits (mkdir -p / tee+stdin / cat / ls -1Ap / stat -c / find / grep -rnIE / rm -r) plus a couple of
// generic commands (echo / pwd / true). That fidelity is the point: the SAME scenario suite runs the real
// createExecutionSelector + createExecWorkspaceAccess against this host (hermetic) and against live engines, so a
// write→read roundtrip actually proves content survives — the shape-only fakes never could.
//
// This is testing/mock infrastructure (never shipped in a production bundle); the real behaviour is the platform
// connectionExec adapter. The two are kept in lockstep by the shared execution-target matrix.

import type { ConnectionExecHost, ConnectionExecOptions, ConnectionExecResult } from "@/ai-system/core/ports";
import { randomUUID } from "@/utils/randomUUID";

const MAX_STREAM_CHARS = 100_000;

// A minimal POSIX-ish filesystem: files by absolute path, plus the set of directories that exist.
interface Vfs {
  files: Map<string, { content: string; mtime: number }>;
  dirs: Set<string>;
}

interface Container {
  id: string;
  label?: string;
  fs: Vfs;
  removed: boolean;
}

function newVfs(): Vfs {
  return { files: new Map(), dirs: new Set(["/"]) };
}

function dirname(abs: string): string {
  const idx = abs.lastIndexOf("/");
  if (idx <= 0) return "/";
  return abs.slice(0, idx);
}

function ensureDir(fs: Vfs, dir: string): void {
  const parts = dir.split("/").filter(Boolean);
  let cur = "";
  fs.dirs.add("/");
  for (const part of parts) {
    cur += `/${part}`;
    fs.dirs.add(cur);
  }
}

function cap(text: string): { value: string; truncated: boolean } {
  return text.length > MAX_STREAM_CHARS
    ? { value: text.slice(0, MAX_STREAM_CHARS), truncated: true }
    : { value: text, truncated: false };
}

function ok(stdout = ""): ConnectionExecResult {
  const c = cap(stdout);
  return { code: 0, stdout: c.value, stderr: "", truncated: c.truncated };
}

// Join lines the way a coreutil would print them: newline-separated with a trailing newline, empty when no rows.
function joinLines(rows: string[]): string {
  return rows.length ? `${rows.join("\n")}\n` : "";
}

function fail(code: number, stderr: string): ConnectionExecResult {
  return { code, stdout: "", stderr, truncated: false };
}

// Emulate one argv against a virtual filesystem. Covers exactly what createExecWorkspaceAccess emits, plus a few
// generic programs (echo/pwd/true) so a worker's execCommand has something real to run.
function runCommand(fs: Vfs, program: string, args: string[], opts?: ConnectionExecOptions): ConnectionExecResult {
  let mtimeSeq = fs.files.size + 1;
  const last = args[args.length - 1];

  switch (program) {
    case "mkdir": {
      // `mkdir -p <dir>`
      ensureDir(fs, last);
      return ok();
    }
    case "tee": {
      // `tee <abs>` with the content piped on stdin (writeFile / editFile).
      const abs = last;
      ensureDir(fs, dirname(abs));
      const content = opts?.input ?? "";
      fs.files.set(abs, { content, mtime: mtimeSeq++ });
      return ok(content);
    }
    case "cat": {
      const entry = fs.files.get(last);
      if (!entry) return fail(1, `cat: ${last}: No such file or directory`);
      return ok(entry.content);
    }
    case "ls": {
      // `ls -1Ap <abs>` — one per line, dotfiles included, dirs get a trailing slash.
      const dir = last;
      if (!fs.dirs.has(dir) && !fs.files.has(dir)) return fail(1, `ls: ${dir}: No such file or directory`);
      const prefix = dir === "/" ? "/" : `${dir}/`;
      const names = new Set<string>();
      for (const sub of fs.dirs) {
        if (sub !== dir && sub.startsWith(prefix)) {
          const rest = sub.slice(prefix.length);
          if (rest && !rest.includes("/")) names.add(`${rest}/`);
        }
      }
      for (const file of fs.files.keys()) {
        if (file.startsWith(prefix)) {
          const rest = file.slice(prefix.length);
          if (rest && !rest.includes("/")) names.add(rest);
        }
      }
      return ok(joinLines([...names].sort()));
    }
    case "stat": {
      // `stat -c "%s %Y %F" <abs>`
      const abs = last;
      const entry = fs.files.get(abs);
      if (entry) return ok(`${entry.content.length} ${entry.mtime} regular file\n`);
      if (fs.dirs.has(abs)) return ok(`0 0 directory\n`);
      return fail(1, `stat: ${abs}: No such file or directory`);
    }
    case "find": {
      // `find <root> -type f`
      const root = args[0];
      const prefix = root === "/" ? "/" : `${root}/`;
      const found: string[] = [];
      for (const file of fs.files.keys()) {
        if (file === root || file.startsWith(prefix)) found.push(file);
      }
      return ok(joinLines(found.sort()));
    }
    case "grep": {
      // `grep -rnIE -- <pattern> <root>` → path:line:text; exit 1 when nothing matches.
      const sep = args.indexOf("--");
      const pattern = sep >= 0 ? args[sep + 1] : args[args.length - 2];
      const root = args[args.length - 1];
      const prefix = root === "/" ? "/" : `${root}/`;
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch {
        return fail(2, `grep: invalid pattern: ${pattern}`);
      }
      const lines: string[] = [];
      for (const [abs, entry] of [...fs.files.entries()].sort()) {
        if (abs !== root && !abs.startsWith(prefix)) continue;
        const rows = entry.content.split("\n");
        rows.forEach((row, i) => {
          if (re.test(row)) lines.push(`${abs}:${i + 1}:${row}`);
        });
      }
      if (!lines.length) return fail(1, "");
      return ok(joinLines(lines));
    }
    case "rm": {
      // `rm -r <abs>` — remove a file or a whole subtree.
      const abs = last;
      const prefix = `${abs}/`;
      let removed = fs.files.delete(abs);
      for (const file of [...fs.files.keys()]) {
        if (file.startsWith(prefix)) {
          fs.files.delete(file);
          removed = true;
        }
      }
      for (const dir of [...fs.dirs]) {
        if (dir === abs || dir.startsWith(prefix)) {
          fs.dirs.delete(dir);
          removed = true;
        }
      }
      if (!removed && !fs.dirs.has(abs)) return fail(1, `rm: ${abs}: No such file or directory`);
      return ok();
    }
    case "echo":
      return ok(`${args.join(" ")}\n`);
    case "pwd":
      return ok(`${opts?.workdir ?? "/"}\n`);
    case "true":
      return ok();
    default:
      // Unknown program: a real engine's `exec` returns 127 for a command that is not on PATH. The mock MUST
      // mirror that — masking it as a silent success let a worker (or a test) shell out to a program this vhost
      // does not emulate and read a fabricated success it would never get live. 127 is the POSIX "command not
      // found" code; the stderr mirrors the shell's own wording so callers can pattern-match it.
      return fail(127, `vhost: unknown command ${program}`);
  }
}

export interface VirtualEngineHostHandle extends ConnectionExecHost {
  // Create a plain, unlabeled, long-lived container (the "existing container" a worker attaches to). Returns its
  // id. Unlike a sandbox it carries no AI label, so teardown assertions never count it.
  createContainer(): string;
  // Live (not-removed) containers, for a test's teardown assertion.
  liveContainers(): { id: string; label?: string }[];
  // Live sandbox containers carrying the AI sandbox label, keyed off the run id in the label value.
  liveSandboxes(): { id: string; label?: string }[];
}

// Build an in-memory ConnectionExecHost. Each connection has its own root filesystem (the remote-host case) and
// its own container registry; a sandbox is a fresh container with an empty /workspace already created (mirroring
// the real adapter, which mkdir's it right after `run -d`).
export function createVirtualEngineHost(): VirtualEngineHostHandle {
  const connectionRoots = new Map<string, Vfs>();
  const containers = new Map<string, Container>();

  function rootFs(connectionId: string): Vfs {
    let fs = connectionRoots.get(connectionId);
    if (!fs) {
      fs = newVfs();
      connectionRoots.set(connectionId, fs);
    }
    return fs;
  }

  function container(containerId: string): Container {
    const c = containers.get(containerId);
    if (!c || c.removed) {
      throw new Error(`no container "${containerId}"`);
    }
    return c;
  }

  return {
    async execOnConnection(connectionId, program, args, opts) {
      return runCommand(rootFs(connectionId), program, args, opts);
    },

    async execInContainer(_connectionId, containerId, program, args, opts) {
      return runCommand(container(containerId).fs, program, args, opts);
    },

    async createSandboxContainer(_connectionId, _image, sandbox) {
      const id = randomUUID().replace(/-/g, "").slice(0, 12);
      const fs = newVfs();
      ensureDir(fs, "/workspace");
      containers.set(id, { id, label: sandbox.label, fs, removed: false });
      return { containerId: id };
    },

    async removeSandboxContainer(_connectionId, containerId) {
      const c = containers.get(containerId);
      if (c) c.removed = true;
    },

    createContainer() {
      const id = randomUUID().replace(/-/g, "").slice(0, 12);
      containers.set(id, { id, fs: newVfs(), removed: false });
      return id;
    },

    liveContainers() {
      return [...containers.values()].filter((c) => !c.removed).map((c) => ({ id: c.id, label: c.label }));
    },

    liveSandboxes() {
      return [...containers.values()]
        .filter((c) => !c.removed && c.label?.startsWith("container-desktop.ai.sandbox="))
        .map((c) => ({ id: c.id, label: c.label }));
    },
  };
}
