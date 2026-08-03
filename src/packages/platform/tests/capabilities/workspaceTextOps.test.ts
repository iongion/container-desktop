import { describe, expect, it } from "vitest";

import {
  applyStringEdit,
  globToRegExp,
  posixDirname,
  posixRelative,
  posixResolve,
} from "@/platform/capabilities/workspaceTextOps";

describe("posixResolve (workspace confinement math)", () => {
  it("resolves relative paths under an absolute root", () => {
    expect(posixResolve("/workspace", "a/b.txt")).toBe("/workspace/a/b.txt");
    expect(posixResolve("/workspace", ".")).toBe("/workspace");
    expect(posixResolve("/workspace", "a//b")).toBe("/workspace/a/b");
    expect(posixResolve("/workspace", "a/./b")).toBe("/workspace/a/b");
  });

  it("normalizes `..` and can escape the root (the caller then rejects the escape)", () => {
    // These MUST land outside /workspace so resolvePosixWithinRoot's prefix check throws — the security boundary.
    expect(posixResolve("/workspace", "../secret")).toBe("/secret");
    expect(posixResolve("/workspace", "a/../../b")).toBe("/b");
    expect(posixResolve("/workspace", "../../etc/passwd")).toBe("/etc/passwd");
    // An absolute requested path wins outright (also outside the root ⇒ rejected by the caller).
    expect(posixResolve("/workspace", "/etc/passwd")).toBe("/etc/passwd");
  });

  it("an absolute path can never rise above /", () => {
    expect(posixResolve("/workspace", "/../../../etc")).toBe("/etc");
    expect(posixResolve("/", "..")).toBe("/");
  });

  it("stays within the root for legitimate nested `..`", () => {
    expect(posixResolve("/workspace", "a/b/../c")).toBe("/workspace/a/c");
  });
});

describe("posixRelative", () => {
  it("computes the path from one absolute path to another", () => {
    expect(posixRelative("/workspace", "/workspace/src/a.ts")).toBe("src/a.ts");
    expect(posixRelative("/workspace", "/workspace")).toBe("");
    expect(posixRelative("/workspace", "/other/x")).toBe("../other/x");
  });
});

describe("posixDirname", () => {
  it("returns the directory of an absolute path", () => {
    expect(posixDirname("/workspace/dir/out.txt")).toBe("/workspace/dir");
    expect(posixDirname("/workspace")).toBe("/");
    expect(posixDirname("bare")).toBe(".");
  });
});

describe("applyStringEdit", () => {
  it("replaces a unique occurrence once", () => {
    expect(applyStringEdit("alpha beta", "beta", "gamma")).toEqual({ after: "alpha gamma", replacements: 1 });
  });
  it("throws when oldString is empty, absent, or ambiguous", () => {
    expect(() => applyStringEdit("x", "", "y")).toThrow(/must not be empty/);
    expect(() => applyStringEdit("x", "z", "y")).toThrow(/not found/);
    expect(() => applyStringEdit("x x", "x", "y")).toThrow(/not unique/);
  });
  it("replaceAll swaps every occurrence", () => {
    expect(applyStringEdit("a a a", "a", "b", true)).toEqual({ after: "b b b", replacements: 3 });
  });
});

describe("globToRegExp", () => {
  it("matches `*` within a segment and `**` across segments", () => {
    expect(globToRegExp("*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("*.ts").test("dir/a.ts")).toBe(false);
    expect(globToRegExp("**/*.ts").test("dir/sub/a.ts")).toBe(true);
    expect(globToRegExp("src/?.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/?.ts").test("src/ab.ts")).toBe(false);
  });
});
