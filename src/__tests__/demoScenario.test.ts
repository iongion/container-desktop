import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The website demo is a screenshot slideshow: demoScenario.json is the ordered frame list and
// demoManifest.ts expands it per engine (at the end of `yarn screenshots`). Guard that every frame
// points at a screenshot the capture actually produces, so the demo can never reference a missing image.
const scenario = JSON.parse(readFileSync(path.resolve("support/cli/media/demoScenario.json"), "utf8"));
const IMG_DIR = path.resolve("website-src/static/img");

describe("demo scenario", () => {
  it("is a simple ordered list of { screenshot, title } frames", () => {
    expect(Array.isArray(scenario.frames)).toBe(true);
    expect(scenario.frames.length).toBeGreaterThan(0);
    expect(scenario.engines).toContain("unified");
    expect(scenario.viewport).toEqual({ width: expect.any(Number), height: expect.any(Number) });
    for (const frame of scenario.frames) {
      expect(typeof frame.screenshot).toBe("string");
      expect(frame.screenshot).toMatch(/\.png$/);
      expect(typeof frame.title).toBe("string");
      expect(frame.title.length).toBeGreaterThan(0);
    }
  });

  it("references only screenshots the capture produces (present in the unified set)", () => {
    for (const frame of scenario.frames) {
      // unified always exists; per-engine folders fall back to it in demoManifest.resolveScreenshot.
      expect(existsSync(path.join(IMG_DIR, "unified", frame.screenshot))).toBe(true);
    }
  });
});
