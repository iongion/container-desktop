import { describe, expect, it } from "vitest";
import { summarizeWorkspaceChanges, type WorkspaceChangeSnapshot } from "@/ai-system/core/workspaceChanges";

function snapshot(fingerprint: string, entries: WorkspaceChangeSnapshot["entries"] = []): WorkspaceChangeSnapshot {
  return {
    origin: { kind: "app" },
    workspaceRoot: "/workspace",
    state: entries.length ? "changes" : "clean",
    entries,
    fingerprint,
    truncated: false,
  };
}

describe("summarizeWorkspaceChanges", () => {
  it("returns no summary when the target-bound state did not change", () => {
    const before = snapshot("same", [{ path: "existing.ts", index: "unchanged", worktree: "modified" }]);

    expect(summarizeWorkspaceChanges(before, before)).toBeUndefined();
  });

  it("reports introduced, cleared, and status-changed paths with before/after totals", () => {
    const before = snapshot("before", [
      { path: "cleared.ts", index: "unchanged", worktree: "modified" },
      { path: "staged.ts", index: "unchanged", worktree: "modified" },
    ]);
    const after = snapshot("after", [
      { path: "added.ts", index: "untracked", worktree: "untracked" },
      { path: "staged.ts", index: "modified", worktree: "unchanged" },
    ]);

    expect(summarizeWorkspaceChanges(before, after)).toEqual({
      origin: { kind: "app" },
      workspaceRoot: "/workspace",
      beforeCount: 2,
      afterCount: 2,
      introduced: ["added.ts"],
      cleared: ["cleared.ts"],
      updated: ["staged.ts"],
      contentChanged: false,
      truncated: false,
    });
  });

  it("honestly reports content-only changes when Git status shape stayed the same", () => {
    const entries = [{ path: "same.ts", index: "unchanged" as const, worktree: "modified" as const }];

    expect(summarizeWorkspaceChanges(snapshot("before", entries), snapshot("after", entries))).toMatchObject({
      introduced: [],
      cleared: [],
      updated: [],
      contentChanged: true,
    });
  });

  it("does not compare snapshots from different targets or workspace roots", () => {
    const before = snapshot("before");
    const after = { ...snapshot("after"), workspaceRoot: "/other" };

    expect(summarizeWorkspaceChanges(before, after)).toBeUndefined();
  });
});
