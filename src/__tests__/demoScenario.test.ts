import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function collectSelectorValues(value: unknown, selectors: string[] = []): string[] {
  if (!value || typeof value !== "object") {
    return selectors;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSelectorValues(item, selectors);
    }
    return selectors;
  }
  for (const [key, child] of Object.entries(value)) {
    if ((key === "selector" || key === "rowSelector" || key === "waitFor") && typeof child === "string") {
      selectors.push(child);
    }
    collectSelectorValues(child, selectors);
  }
  return selectors;
}

describe("demo scenario", () => {
  it("does not hardcode generated mock container ids", () => {
    const scenario = JSON.parse(readFileSync(path.resolve("support/demoScenario.json"), "utf8"));
    const selectors = collectSelectorValues(scenario);

    expect(selectors).toContain("[data-container]");
    expect(selectors.filter((selector) => /\[data-container="[^"]+"\]/.test(selector))).toEqual([]);
  });
});
