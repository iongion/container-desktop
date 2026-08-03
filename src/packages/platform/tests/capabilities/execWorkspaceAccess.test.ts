import { describe, expect, it } from "vitest";

import type { ConnectionExecResult } from "@/ai-system/core/ports";
import { createExecWorkspaceAccess, resolvePosixWithinRoot } from "@/platform/capabilities/execWorkspaceAccess";

interface ExecCall {
  program: string;
  args: string[];
  input?: string;
}

function fakeExec(handler: (program: string, args: string[]) => Partial<ConnectionExecResult>) {
  const calls: ExecCall[] = [];
  const exec = async (program: string, args: string[], opts?: { input?: string }) => {
    calls.push({ program, args, input: opts?.input });
    const r = handler(program, args);
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", truncated: r.truncated ?? false };
  };
  return { exec, calls };
}

describe("resolvePosixWithinRoot", () => {
  it("resolves relative paths and rejects escapes", () => {
    expect(resolvePosixWithinRoot("/workspace", "a/b.txt")).toBe("/workspace/a/b.txt");
    expect(resolvePosixWithinRoot("/workspace", ".")).toBe("/workspace");
    expect(() => resolvePosixWithinRoot("/workspace", "../secret")).toThrow(/escapes/);
    expect(() => resolvePosixWithinRoot("/workspace", "/etc/passwd")).toThrow(/escapes/);
    expect(() => resolvePosixWithinRoot("/workspace", "a/../../b")).toThrow(/escapes/);
  });
});

describe("createExecWorkspaceAccess", () => {
  it("read → cat with an absolute target path", async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: "hello" }));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    expect(await ws.read("notes/a.txt")).toBe("hello");
    expect(calls[0]).toEqual({ program: "cat", args: ["/workspace/notes/a.txt"], input: undefined });
  });

  it("read rejects a path escape before running anything", async () => {
    const { exec, calls } = fakeExec(() => ({}));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    await expect(ws.read("../etc/passwd")).rejects.toThrow(/escapes/);
    expect(calls.length).toBe(0);
  });

  it("write → mkdir -p then tee with contents on stdin (no shell)", async () => {
    const { exec, calls } = fakeExec(() => ({}));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    await ws.write("dir/out.txt", "body");
    expect(calls[0]).toEqual({ program: "mkdir", args: ["-p", "/workspace/dir"], input: undefined });
    expect(calls[1]).toEqual({ program: "tee", args: ["/workspace/dir/out.txt"], input: "body" });
  });

  it("writeNew atomically links a target-side temporary file without a shell", async () => {
    const { exec, calls } = fakeExec((program) =>
      program === "mktemp" ? { stdout: "/workspace/dir/.container-desktop-new.ABC123\n" } : {},
    );
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });

    await expect(ws.writeNew("dir/rules.md", "body")).resolves.toBe("created");
    expect(calls).toEqual([
      { program: "mkdir", args: ["-p", "/workspace/dir"], input: undefined },
      {
        program: "mktemp",
        args: ["/workspace/dir/.container-desktop-new.XXXXXX"],
        input: undefined,
      },
      {
        program: "tee",
        args: ["/workspace/dir/.container-desktop-new.ABC123"],
        input: "body",
      },
      {
        program: "ln",
        args: ["/workspace/dir/.container-desktop-new.ABC123", "/workspace/dir/rules.md"],
        input: undefined,
      },
      {
        program: "rm",
        args: ["-f", "/workspace/dir/.container-desktop-new.ABC123"],
        input: undefined,
      },
    ]);
  });

  it("writeNew reports an existing destination and always removes its temporary file", async () => {
    const { exec, calls } = fakeExec((program) => {
      if (program === "mktemp") return { stdout: "/workspace/.container-desktop-new.X\n" };
      if (program === "ln") return { code: 1, stderr: "File exists" };
      if (program === "stat") return { stdout: "1 1 regular file\n" };
      return {};
    });
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });

    await expect(ws.writeNew("rules.md", "body")).resolves.toBe("exists");
    expect(calls.at(-1)).toEqual({
      program: "rm",
      args: ["-f", "/workspace/.container-desktop-new.X"],
      input: undefined,
    });
  });

  it("edit reads, applies exact-once replacement, writes back", async () => {
    const { exec, calls } = fakeExec((program) => (program === "cat" ? { stdout: "alpha beta" } : {}));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    const result = await ws.edit("f.txt", "beta", "gamma");
    expect(result).toMatchObject({ path: "f.txt", before: "alpha beta", after: "alpha gamma", replacements: 1 });
    expect(calls.find((c) => c.program === "tee")?.input).toBe("alpha gamma");
  });

  it("edit throws when oldString is not unique", async () => {
    const { exec } = fakeExec((program) => (program === "cat" ? { stdout: "x x" } : {}));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    await expect(ws.edit("f.txt", "x", "y")).rejects.toThrow(/unique/);
  });

  it("list parses `ls -1Ap` trailing-slash directories", async () => {
    const { exec } = fakeExec(() => ({ stdout: "src/\nREADME.md\n.env\n" }));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    expect(await ws.list()).toEqual([
      { name: "src", kind: "directory" },
      { name: "README.md", kind: "file" },
      { name: ".env", kind: "file" },
    ]);
  });

  it("stat parses `stat -c` size/mtime/type", async () => {
    const { exec } = fakeExec(() => ({ stdout: "1234 1700000000 regular file\n" }));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    expect(await ws.stat("a.txt")).toEqual({
      path: "a.txt",
      kind: "file",
      size: 1234,
      modifiedMs: 1700000000000,
    });
  });

  it("stat falls back to BSD `stat -f` when GNU `stat -c` is unsupported (macOS remote)", async () => {
    const { exec, calls } = fakeExec((program, args) =>
      program === "stat" && args[0] === "-c"
        ? { code: 1, stderr: "stat: illegal option -- c" }
        : { code: 0, stdout: "2048 1700000000 Directory\n" },
    );
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    // BSD `%HT` prints "Directory" (capitalized) — parsed case-insensitively.
    expect(await ws.stat("d")).toEqual({ path: "d", kind: "directory", size: 2048, modifiedMs: 1700000000000 });
    expect(calls.filter((c) => c.program === "stat").map((c) => c.args[0])).toEqual(["-c", "-f"]);
  });

  it("stat caches the working dialect so later stats skip the failing probe", async () => {
    const { exec, calls } = fakeExec((_program, args) =>
      args[0] === "-c" ? { code: 1, stderr: "illegal option" } : { code: 0, stdout: "10 1 Regular File\n" },
    );
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    await ws.stat("a");
    await ws.stat("b");
    // First stat probes GNU then BSD; the second reuses BSD directly.
    expect(calls.map((c) => c.args[0])).toEqual(["-c", "-f", "-f"]);
  });

  it("stat throws when neither dialect succeeds (missing path)", async () => {
    const { exec } = fakeExec(() => ({ code: 1, stderr: "No such file or directory" }));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    await expect(ws.stat("missing")).rejects.toThrow(/not found/);
  });

  it("glob lists files via find and matches relative paths, skipping ignored dirs", async () => {
    const { exec, calls } = fakeExec(() => ({
      stdout: "/workspace/src/a.ts\n/workspace/src/b.js\n/workspace/.git/x\n/workspace/node_modules/y.ts\n",
    }));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    expect(await ws.glob("**/*.ts")).toEqual(["src/a.ts"]);
    expect(calls[0]).toEqual({ program: "find", args: ["/workspace", "-type", "f"], input: undefined });
  });

  it("grep parses file:line:text, treats exit 1 as no matches", async () => {
    const noMatch = fakeExec(() => ({ code: 1, stdout: "" }));
    const wsEmpty = createExecWorkspaceAccess({ root: "/workspace", exec: noMatch.exec });
    expect(await wsEmpty.grep("nope")).toEqual([]);

    const hit = fakeExec(() => ({
      stdout: "/workspace/src/a.ts:12:  const x = 1\n/workspace/node_modules/z:3:skip\n",
    }));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec: hit.exec });
    expect(await ws.grep("const")).toEqual([{ path: "src/a.ts", line: 12, text: "  const x = 1" }]);
  });

  it("exec passes program/args through and maps the result", async () => {
    const { exec, calls } = fakeExec(() => ({ code: 0, stdout: "ok", stderr: "" }));
    const ws = createExecWorkspaceAccess({ root: "/workspace", exec });
    const res = await ws.exec("node", ["-v"]);
    expect(res).toMatchObject({ program: "node", args: ["-v"], code: 0, stdout: "ok" });
    expect(calls[0]).toEqual({ program: "node", args: ["-v"], input: undefined });
  });
});
