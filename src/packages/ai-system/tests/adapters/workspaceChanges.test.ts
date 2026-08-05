import { describe, expect, it, vi } from "vitest";
import { createGitWorkspaceChanges } from "@/ai-system/adapters/workspaceChanges";
import type { WorkspaceChangesPort } from "@/ai-system/core/workspaceChanges";
import type { ExecuteIsolated } from "@/host-contract/capabilities";
import type { CommandExecutionResult } from "@/host-contract/exec";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";

function result(overrides: Partial<CommandExecutionResult> = {}): CommandExecutionResult {
  return {
    pid: 1,
    code: 0,
    success: true,
    stdout: "",
    stderr: "",
    command: "git",
    ...overrides,
  };
}

function workspace(root = "/workspace"): IWorkspaceAccess {
  return {
    root: vi.fn(async () => root),
    stat: vi.fn(async (path: string) => ({ path, kind: "file", size: 4, modifiedMs: 10 })),
  } as unknown as IWorkspaceAccess;
}

function inspector(exec: ExecuteIsolated, root = "/workspace"): WorkspaceChangesPort {
  return createGitWorkspaceChanges({
    exec,
    workspace: workspace(root),
    origin: { kind: "app" },
    baseEnv: {
      PATH: "/usr/bin:/bin",
      HOME: "/home/user",
      GITHUB_TOKEN: "must-not-leak",
    },
  });
}

describe("Git workspace changes", () => {
  it("uses only fixed, workspace-scoped argv with an isolated environment and timeout", async () => {
    const exec = vi.fn<ExecuteIsolated>(async () => result());

    await inspector(exec).status();

    expect(exec).toHaveBeenCalledTimes(3);
    for (const [program, args, options] of exec.mock.calls) {
      expect(program).toBe("git");
      expect(args).toContain("--");
      expect(args.at(-1)).toBe(".");
      expect(args).toContain("core.fsmonitor=false");
      expect(options.cwd).toBe("/workspace");
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(15_000);
      expect(options.env.PATH).toBe("/usr/bin:/bin");
      expect(options.env.GIT_PAGER).toBe("cat");
      expect(options.env.GIT_TERMINAL_PROMPT).toBe("0");
      expect(options.env.GITHUB_TOKEN).toBeUndefined();
    }
    expect(exec.mock.calls[0]?.[1]).toContain("--porcelain=v2");
    expect(exec.mock.calls[1]?.[1]).toContain("--no-ext-diff");
    expect(exec.mock.calls[2]?.[1]).toContain("--no-ext-diff");
  });

  it("parses porcelain-v2 status, confines paths to the workspace, and carries target identity", async () => {
    const output = [
      "1 M. N... 100644 100644 100644 abc def src/staged.ts",
      "1 .M N... 100644 100644 100644 abc def src/working.ts",
      "2 R. N... 100644 100644 100644 abc def R100 src/new name.ts",
      "src/old name.ts",
      "? notes.txt",
      "? ../escape.txt",
      "",
    ].join("\u0000");
    const exec = vi
      .fn<ExecuteIsolated>()
      .mockResolvedValueOnce(result({ stdout: output }))
      .mockResolvedValueOnce(result({ stdout: "working patch" }))
      .mockResolvedValueOnce(result({ stdout: "staged patch" }));

    const snapshot = await inspector(exec).status();

    expect(snapshot.origin).toEqual({ kind: "app" });
    expect(snapshot.workspaceRoot).toBe("/workspace");
    expect(snapshot.state).toBe("changes");
    if (snapshot.state !== "changes") throw new Error("expected changes");
    expect(snapshot.entries).toEqual([
      { path: "src/staged.ts", index: "modified", worktree: "unchanged" },
      { path: "src/working.ts", index: "unchanged", worktree: "modified" },
      {
        path: "src/new name.ts",
        previousPath: "src/old name.ts",
        index: "renamed",
        worktree: "unchanged",
      },
      { path: "notes.txt", index: "untracked", worktree: "untracked" },
    ]);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns an explicit non-repository state instead of treating Git failure as clean", async () => {
    const exec = vi.fn(async () =>
      result({ code: 128, success: false, stderr: "fatal: not a git repository (or any parent)" }),
    );

    const snapshot = await inspector(exec).status();

    expect(snapshot.state).toBe("not-repository");
    if (snapshot.state !== "not-repository") throw new Error("expected non-repository");
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.message).toBe("Not a Git repository");
  });

  it("redacts and caps staged and unstaged patches while listing untracked files separately", async () => {
    const token = "ghp_aaaaaaaaaaaaaaaaaaaaaa";
    const exec = vi
      .fn<ExecuteIsolated>()
      .mockResolvedValueOnce(result({ stdout: `? secret-${token}.txt\u0000` }))
      .mockResolvedValueOnce(result({ stdout: `diff ${token}\n${"x".repeat(300_000)}` }))
      .mockResolvedValueOnce(result({ stdout: `staged ${token}` }));

    const diff = await inspector(exec).diff();

    expect(diff.state).toBe("changes");
    if (diff.state !== "changes") throw new Error("expected changes");
    expect(diff.untracked).toEqual(["secret-[REDACTED].txt"]);
    expect(diff.unstaged).not.toContain(token);
    expect(diff.staged).not.toContain(token);
    expect(diff.truncated).toBe(true);
    expect(diff.unstaged.length).toBeLessThan(150_000);
  });
});
