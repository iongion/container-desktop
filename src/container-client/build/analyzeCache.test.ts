import { describe, expect, it } from "vitest";
import { analyzeCache } from "./analyzeCache";
import type { BuildStep } from "./types";

const step = (over: Partial<BuildStep>): BuildStep => ({
  key: "k",
  index: 1,
  name: "RUN x",
  status: "done",
  cached: false,
  logs: [],
  ...over,
});

describe("analyzeCache", () => {
  it("counts cached vs rebuilt, finds the first miss and classifies the breaker", () => {
    const steps = [
      step({ key: "a", name: "FROM node", cached: true, status: "cached" }),
      step({ key: "b", name: "RUN npm ci", cached: true, status: "cached" }),
      step({ key: "c", name: "COPY . .", cached: false }),
      step({ key: "d", name: "RUN npm run build", cached: false }),
    ];
    const result = analyzeCache(steps);
    expect(result.firstMissIndex).toBe(2);
    expect(result.cachedCount).toBe(2);
    expect(result.rebuiltCount).toBe(2);
    expect(result.breaker?.name).toContain("COPY . .");
    expect(result.breaker?.likelyCause).toBe("context-changed");
    expect(result.cascadeKeys).toEqual(["c", "d"]);
  });

  it("does not cascade into an independent, still-cached stage", () => {
    const steps = [
      step({ key: "a", name: "FROM node AS deps", cached: true, status: "cached" }),
      step({ key: "c", name: "COPY . .", cached: false }),
      step({ key: "d", name: "RUN build", cached: false }),
      step({ key: "e", name: "FROM nginx", cached: true, status: "cached" }),
      step({ key: "f", name: "COPY --from=deps /app /html", cached: true, status: "cached" }),
    ];
    expect(analyzeCache(steps).cascadeKeys).toEqual(["c", "d"]);
  });

  it("reports firstMissIndex -1 and no breaker when fully cached", () => {
    const steps = [step({ key: "a", cached: true }), step({ key: "b", cached: true })];
    const result = analyzeCache(steps);
    expect(result.firstMissIndex).toBe(-1);
    expect(result.breaker).toBeUndefined();
    expect(result.cascadeKeys).toEqual([]);
  });
});
