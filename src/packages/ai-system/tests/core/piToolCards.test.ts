import { describe, expect, it } from "vitest";

import { piCardResult, piToolSummary, resolvePiCardKind } from "@/ai-system/core/piToolCards";

describe("resolvePiCardKind", () => {
  it("maps each pi built-in to the card that already renders that shape", () => {
    expect(resolvePiCardKind("bash")).toBe("exec");
    expect(resolvePiCardKind("read")).toBe("file");
    expect(resolvePiCardKind("write")).toBe("file");
    expect(resolvePiCardKind("edit")).toBe("diff");
    expect(resolvePiCardKind("ls")).toBe("listing");
    expect(resolvePiCardKind("grep")).toBe("search");
    expect(resolvePiCardKind("find")).toBe("search");
  });

  it("has no card for a tool nobody has classified, so the transcript falls back to JSON", () => {
    expect(resolvePiCardKind("gondolin_vm_status")).toBeUndefined();
    expect(resolvePiCardKind("")).toBeUndefined();
  });
});

describe("piToolSummary", () => {
  it("summarises bash as its command", () => {
    expect(piToolSummary("bash", { command: "yarn test" })).toBe("bash yarn test");
  });

  it("collapses a multi-line command to its first line", () => {
    expect(piToolSummary("bash", { command: "cd x\nyarn test" })).toBe("bash cd x…");
  });

  it("summarises read with its path and line range", () => {
    expect(piToolSummary("read", { path: "src/app.ts", offset: 10, limit: 20 })).toBe("read src/app.ts:10-29");
    expect(piToolSummary("read", { path: "src/app.ts" })).toBe("read src/app.ts");
  });

  it("summarises the file tools with their path", () => {
    expect(piToolSummary("write", { path: "new.ts", content: "x" })).toBe("write new.ts");
    expect(piToolSummary("edit", { path: "src/app.ts", edits: [] })).toBe("edit src/app.ts");
    expect(piToolSummary("ls", { path: "src" })).toBe("ls src");
  });

  it("defaults ls to the working directory pi lists when no path is given", () => {
    expect(piToolSummary("ls", {})).toBe("ls .");
  });

  it("summarises the search tools as pattern in path", () => {
    expect(piToolSummary("grep", { pattern: "TODO", path: "src" })).toBe("grep TODO in src");
    expect(piToolSummary("grep", { pattern: "TODO" })).toBe("grep TODO");
    expect(piToolSummary("find", { pattern: "*.ts" })).toBe("find *.ts");
  });

  it("is just the tool name while streamed arguments are still partial", () => {
    expect(piToolSummary("bash", undefined)).toBe("bash");
    expect(piToolSummary("bash", {})).toBe("bash");
    expect(piToolSummary("read", { path: "" })).toBe("read");
  });

  it("falls back to the bare name for a tool it does not know", () => {
    expect(piToolSummary("gondolin_vm_status", { vm: "a" })).toBe("gondolin_vm_status");
  });

  it("caps a very long summary", () => {
    const summary = piToolSummary("bash", { command: "x".repeat(500) });
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary.endsWith("…")).toBe(true);
  });
});

// pi's built-in tools return their payload as TEXT; `details` carries only truncation and limit flags. These
// cases are the shapes the existing cards read, rebuilt from (args, text, details).
describe("piCardResult", () => {
  it("gives the exec card the command and its output, and never invents an exit code", () => {
    const result = piCardResult("bash", { command: "yarn test" }, "3 passed\n", undefined);
    expect(result).toEqual({ program: "yarn test", args: [], stdout: "3 passed", code: undefined });
  });

  it("gives the file card a read's path and content", () => {
    expect(piCardResult("read", { path: "src/app.ts" }, "const a = 1;\n", undefined)).toEqual({
      path: "src/app.ts",
      content: "const a = 1;",
      notice: undefined,
    });
  });

  it("surfaces pi's truncation notice instead of leaving it in the content", () => {
    const text = "const a = 1;\n\n[Showing lines 1-1 of 900. Use offset=2 to continue.]";
    expect(piCardResult("read", { path: "src/app.ts" }, text, { truncation: { truncated: true } })).toEqual({
      path: "src/app.ts",
      content: "const a = 1;",
      notice: "Showing lines 1-1 of 900. Use offset=2 to continue.",
    });
  });

  it("shows a write from its arguments, because pi only returns a byte count", () => {
    expect(
      piCardResult("write", { path: "new.ts", content: "export {};\n" }, "Successfully wrote 11 bytes", undefined),
    ).toEqual({ path: "new.ts", content: "export {};", notice: undefined });
  });

  it("hands the diff card pi's unified patch", () => {
    const details = { diff: "…", patch: "--- a/x.ts\n+++ b/x.ts\n", firstChangedLine: 4 };
    expect(piCardResult("edit", { path: "x.ts" }, "ok", details)).toEqual({
      path: "x.ts",
      patch: "--- a/x.ts\n+++ b/x.ts\n",
      firstChangedLine: 4,
    });
  });

  it("parses an ls listing, marking directories by pi's trailing slash", () => {
    expect(piCardResult("ls", { path: "src" }, "README.md\nsrc/\n", undefined)).toEqual({
      path: "src",
      entries: [
        { name: "README.md", kind: "file" },
        { name: "src", kind: "directory" },
      ],
      notice: undefined,
    });
  });

  it("reads an empty directory as no entries rather than one entry named after the message", () => {
    expect(piCardResult("ls", {}, "(empty directory)", undefined)).toMatchObject({ entries: [] });
  });

  it("keeps an ls entry-limit notice out of the entry list", () => {
    const text = "a\nb\n\n[500 entries limit reached. Use limit=1000 for more]";
    const result = piCardResult("ls", {}, text, { entryLimitReached: 500 });
    expect(result).toMatchObject({
      entries: [
        { name: "a", kind: "file" },
        { name: "b", kind: "file" },
      ],
      notice: "500 entries limit reached. Use limit=1000 for more",
    });
  });

  it("parses grep matches from pi's path:line: text format", () => {
    const text = "src/a.ts:12: const x = 1;\nsrc/b.ts:3: const y = 2;";
    expect(piCardResult("grep", { pattern: "const" }, text, undefined)).toEqual({
      pattern: "const",
      matches: [
        { path: "src/a.ts", line: 12, text: "const x = 1;", context: false },
        { path: "src/b.ts", line: 3, text: "const y = 2;", context: false },
      ],
      notice: undefined,
    });
  });

  it("keeps grep context lines, which pi marks with dashes instead of colons", () => {
    const text = "src/a.ts-11- before\nsrc/a.ts:12: const x = 1;";
    expect(piCardResult("grep", { pattern: "const" }, text, undefined)).toMatchObject({
      matches: [
        { path: "src/a.ts", line: 11, text: "before", context: true },
        { path: "src/a.ts", line: 12, text: "const x = 1;", context: false },
      ],
    });
  });

  it("reads grep's no-match message as an empty match list", () => {
    expect(piCardResult("grep", { pattern: "zzz" }, "No matches found", undefined)).toMatchObject({ matches: [] });
  });

  it("parses find results as a path list", () => {
    expect(piCardResult("find", { pattern: "*.ts" }, "src/a.ts\nsrc/b.ts\n", undefined)).toEqual({
      pattern: "*.ts",
      files: ["src/a.ts", "src/b.ts"],
      notice: undefined,
    });
  });

  it("reads find's no-result message as an empty path list", () => {
    expect(piCardResult("find", { pattern: "*.zz" }, "No files found matching pattern", undefined)).toMatchObject({
      files: [],
    });
  });

  it("returns undefined for a tool with no card, so the generic JSON view keeps pi's own details", () => {
    expect(piCardResult("gondolin_vm_status", { vm: "a" }, "running", { extra: 1 })).toBeUndefined();
  });

  it("tolerates a blocked tool's empty details and missing text", () => {
    expect(piCardResult("bash", { command: "rm -rf /" }, "", {})).toEqual({
      program: "rm -rf /",
      args: [],
      stdout: "",
      code: undefined,
    });
    expect(piCardResult("edit", { path: "x.ts" }, "", {})).toEqual({
      path: "x.ts",
      patch: undefined,
      firstChangedLine: undefined,
    });
  });
});
