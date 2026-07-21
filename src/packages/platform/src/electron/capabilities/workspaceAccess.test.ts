import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandExecutionResult } from "@/host-contract/exec";
import {
  applyStringEdit,
  createNodeWorkspaceAccess,
  globToRegExp,
  resolveWithinRoot,
} from "@/platform/electron/capabilities/workspaceAccess";

describe("resolveWithinRoot", () => {
  const root = path.resolve("/ws");
  it("resolves in-root paths (including harmless internal ..)", () => {
    expect(resolveWithinRoot(root, "a.ts")).toBe(path.join(root, "a.ts"));
    expect(resolveWithinRoot(root, "sub/b.ts")).toBe(path.join(root, "sub", "b.ts"));
    expect(resolveWithinRoot(root, "sub/../a.ts")).toBe(path.join(root, "a.ts"));
    expect(resolveWithinRoot(root, ".")).toBe(root);
  });
  it("rejects paths that escape the root", () => {
    expect(() => resolveWithinRoot(root, "../etc/passwd")).toThrow(/escapes/);
    expect(() => resolveWithinRoot(root, "..")).toThrow(/escapes/);
    expect(() => resolveWithinRoot(root, "/etc/passwd")).toThrow(/escapes/);
    // A sibling dir sharing the root's name prefix must not count as inside.
    expect(() => resolveWithinRoot(root, "../ws-evil/x")).toThrow(/escapes/);
  });
});

describe("applyStringEdit", () => {
  it("replaces a unique occurrence", () => {
    expect(applyStringEdit("a foo b", "foo", "bar")).toEqual({ after: "a bar b", replacements: 1 });
  });
  it("throws when oldString is not found", () => {
    expect(() => applyStringEdit("abc", "x", "y")).toThrow(/not found/);
  });
  it("throws when oldString is ambiguous without replaceAll", () => {
    expect(() => applyStringEdit("x x x", "x", "y")).toThrow(/not unique/);
  });
  it("replaceAll replaces every occurrence and counts them", () => {
    expect(applyStringEdit("x x x", "x", "y", true)).toEqual({ after: "y y y", replacements: 3 });
  });
  it("rejects an empty oldString", () => {
    expect(() => applyStringEdit("abc", "", "y")).toThrow(/must not be empty/);
  });
});

describe("globToRegExp", () => {
  it("matches * within a segment but not across a slash", () => {
    expect(globToRegExp("*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("*.ts").test("sub/a.ts")).toBe(false);
  });
  it("matches ** across segments (and at the root)", () => {
    expect(globToRegExp("src/**/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/x/y.ts")).toBe(true);
    expect(globToRegExp("**/*.ts").test("a.ts")).toBe(true);
  });
  it("? matches exactly one non-slash char", () => {
    expect(globToRegExp("a?.ts").test("ab.ts")).toBe(true);
    expect(globToRegExp("a?.ts").test("a/.ts")).toBe(false);
  });
});

describe("createNodeWorkspaceAccess (confined node impl)", () => {
  let base: string;
  let root: string;
  let outside: string;
  const noExec = async (): Promise<CommandExecutionResult> => ({ pid: 1, code: 0, success: true });
  const make = () => createNodeWorkspaceAccess({ resolveRoot: () => root, exec: noExec });

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "cw-test-"));
    root = path.join(base, "ws");
    outside = path.join(base, "outside");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(root, "a.ts"), "const x = 1;\nconst y = 2;\n");
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "b.ts"), "export const foo = 1;\n");
    await fs.writeFile(path.join(outside, "secret.txt"), "TOP SECRET");
  });
  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("reads a file inside the workspace", async () => {
    expect(await make().read("a.ts")).toContain("const x = 1;");
  });

  it("edits a file surgically and persists the change", async () => {
    const result = await make().edit("a.ts", "const x = 1;", "const x = 42;");
    expect(result.replacements).toBe(1);
    expect(result.after).toContain("const x = 42;");
    expect(await make().read("a.ts")).toContain("const x = 42;");
  });

  it("lists a directory and globs by pattern", async () => {
    const entries = await make().list(".");
    expect(entries.map((e) => e.name).sort()).toEqual(["a.ts", "src"]);
    const globbed = await make().glob("**/*.ts");
    expect(globbed.sort()).toEqual(["a.ts", "src/b.ts"]);
  });

  it("greps file contents with 1-based line numbers", async () => {
    const matches = await make().grep("foo");
    expect(matches).toEqual([{ path: "src/b.ts", line: 1, text: "export const foo = 1;" }]);
  });

  it("writes and removes within the workspace", async () => {
    await make().write("new/created.txt", "hi");
    expect(await make().read("new/created.txt")).toBe("hi");
    await make().remove("new/created.txt");
    await expect(make().read("new/created.txt")).rejects.toThrow();
  });

  // The 🔴 requirement: confinement is enforced HOST-SIDE, not in the JS tool.
  it("rejects a path that escapes the root via ..", async () => {
    await expect(make().read("../outside/secret.txt")).rejects.toThrow(/escapes/);
  });

  it("rejects reading through a symlink that points outside the workspace", async () => {
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    await expect(make().read("link.txt")).rejects.toThrow(/escapes/);
  });

  it("rejects every op when no workspace root is configured", async () => {
    const ws = createNodeWorkspaceAccess({ resolveRoot: () => undefined, exec: noExec });
    await expect(ws.read("a.ts")).rejects.toThrow(/No workspace/);
  });

  it("pins exec to the canonical workspace root", async () => {
    let seenCwd = "";
    const ws = createNodeWorkspaceAccess({
      resolveRoot: () => root,
      exec: async (program, args, opts) => {
        seenCwd = opts.cwd;
        return { pid: 1, code: 0, success: true, stdout: `${program} ${args.join(" ")}`, stderr: "" };
      },
    });
    const out = await ws.exec("echo", ["hi"]);
    expect(out).toMatchObject({ code: 0, stdout: "echo hi" });
    expect(seenCwd).toBe(await fs.realpath(root));
  });
});
