// WebKitWebDriver collapses a run of identical keys inside ONE action chain: `browser.keys("all")` arrives as
// "al", and `browser.keys(" add")` as " ad". Proved against a plain textarea appended outside React, so it is the
// driver's chain and not the app's composer. The fix is to hand the driver chains that never repeat a character;
// this is the split that guarantees it.
import { describe, expect, it } from "vitest";

import { keystrokeChunks } from "./webdriverioDriver.mjs";

describe("keystrokeChunks", () => {
  it("keeps text with no repeated character in one chain", () => {
    expect(keystrokeChunks("/memory")).toEqual(["/memory"]);
  });

  it("breaks the chain before a repeated character", () => {
    expect(keystrokeChunks("all")).toEqual(["al", "l"]);
    expect(keystrokeChunks(" add")).toEqual([" ad", "d"]);
  });

  it("breaks once per repeat, however long the run", () => {
    expect(keystrokeChunks("aaaa")).toEqual(["a", "a", "a", "a"]);
  });

  it("splits every repeat in a real skill command", () => {
    expect(keystrokeChunks("/skill:e2e-skill-abc")).toEqual(["/skil", "l:e2e-skil", "l-abc"]);
  });

  it("rejoins to exactly the text asked for", () => {
    for (const text of ["", "/memory add", "all well llama", "/skill:user:e2e-skill-x9", "aa bb  cc"]) {
      expect(keystrokeChunks(text).join("")).toBe(text);
    }
  });

  it("has no chunk carrying two identical characters in a row", () => {
    for (const chunk of keystrokeChunks("all well llama")) {
      expect([...chunk].some((character, index) => index > 0 && character === chunk[index - 1])).toBe(false);
    }
  });

  it("types nothing for empty text", () => {
    expect(keystrokeChunks("")).toEqual([]);
  });
});
