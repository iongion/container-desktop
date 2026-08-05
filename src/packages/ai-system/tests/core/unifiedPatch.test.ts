import { describe, expect, it } from "vitest";

import { parseUnifiedPatch } from "@/ai-system/core/unifiedPatch";

const patch = [
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,4 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
].join("\n");

describe("parseUnifiedPatch", () => {
  it("extracts the file path from the +++ header", () => {
    expect(parseUnifiedPatch(patch).path).toBe("src/app.ts");
  });

  // pi builds its patch with jsdiff's createTwoFilesPatch and passes the workspace path unchanged, so its
  // headers carry no a/ or b/ prefix to strip.
  it("takes the path as-is when pi emits no a/ or b/ prefix", () => {
    const piPatch = ["--- src/app.ts", "+++ src/app.ts", "@@ -1,1 +1,1 @@", "-old", "+new"].join("\n");
    expect(parseUnifiedPatch(piPatch).path).toBe("src/app.ts");
  });

  it("extracts one hunk with its start lines", () => {
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 1, newStart: 1, header: "@@ -1,4 +1,4 @@" });
  });

  it("classifies each line and numbers both sides", () => {
    const lines = parseUnifiedPatch(patch).hunks[0].lines;
    expect(lines.map((line) => line.kind)).toEqual(["context", "removed", "added", "context"]);
    expect(lines[0]).toMatchObject({ oldLine: 1, newLine: 1 });
    // A removed line has no new-side number and an added line has no old-side one, so each gutter can render
    // a blank rather than a misleading number.
    expect(lines[1]).toMatchObject({ kind: "removed", oldLine: 2 });
    expect(lines[1].newLine).toBeUndefined();
    expect(lines[2]).toMatchObject({ kind: "added", newLine: 2 });
    expect(lines[2].oldLine).toBeUndefined();
    expect(lines[3]).toMatchObject({ oldLine: 3, newLine: 3 });
  });

  it("handles several hunks", () => {
    const multi = `${patch}\n@@ -20,2 +20,3 @@\n context\n+added\n`;
    const { hunks } = parseUnifiedPatch(multi);
    expect(hunks).toHaveLength(2);
    expect(hunks[1]).toMatchObject({ oldStart: 20, newStart: 20 });
  });

  it("accepts a single-line hunk header, which omits the counts", () => {
    const single = ["+++ x.ts", "@@ -3 +3 @@", "-a", "+b"].join("\n");
    expect(parseUnifiedPatch(single).hunks[0]).toMatchObject({ oldStart: 3, newStart: 3 });
  });

  it("returns no hunks for an empty or malformed patch instead of throwing", () => {
    expect(parseUnifiedPatch("")).toEqual({ path: undefined, hunks: [], added: 0, removed: 0 });
    expect(parseUnifiedPatch("not a patch at all")).toEqual({ path: undefined, hunks: [], added: 0, removed: 0 });
  });

  it("keeps a line whose content starts with a diff marker", () => {
    const tricky = ["+++ b/x.ts", "@@ -1,1 +1,1 @@", "-  --flag", "+  --other"].join("\n");
    const lines = parseUnifiedPatch(tricky).hunks[0].lines;
    expect(lines.map((line) => line.text)).toEqual(["  --flag", "  --other"]);
  });

  it("ignores jsdiff's no-newline-at-end-of-file marker", () => {
    const marker = ["+++ x.ts", "@@ -1,1 +1,1 @@", "-a", "\\ No newline at end of file", "+b"].join("\n");
    const lines = parseUnifiedPatch(marker).hunks[0].lines;
    expect(lines.map((line) => line.kind)).toEqual(["removed", "added"]);
  });

  it("reads an empty context line, which a unified patch writes as a bare space or nothing at all", () => {
    const blank = ["+++ x.ts", "@@ -1,3 +1,3 @@", " a", "", "+b"].join("\n");
    const lines = parseUnifiedPatch(blank).hunks[0].lines;
    expect(lines.map((line) => line.kind)).toEqual(["context", "context", "added"]);
    expect(lines[1].text).toBe("");
  });

  it("counts added and removed lines per patch so a card can title itself", () => {
    expect(parseUnifiedPatch(patch)).toMatchObject({ added: 1, removed: 1 });
  });
});
