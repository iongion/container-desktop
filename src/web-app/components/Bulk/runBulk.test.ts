import { describe, expect, it } from "vitest";

import { runBulk } from "./runBulk";

describe("runBulk", () => {
  it("returns empty buckets for no items", async () => {
    const result = await runBulk([], async () => true);
    expect(result).toEqual({ ok: [], failed: [] });
  });

  it("collects every successful item in input order", async () => {
    const result = await runBulk([1, 2, 3], async () => true);
    expect(result.ok).toEqual([1, 2, 3]);
    expect(result.failed).toEqual([]);
  });

  it("partitions thrown errors and falsy results as failures, preserving order", async () => {
    const result = await runBulk(["a", "b", "c", "d"], async (item) => {
      if (item === "b") throw new Error("boom");
      if (item === "c") return false;
      return true;
    });
    expect(result.ok).toEqual(["a", "d"]);
    expect(result.failed.map((f) => f.item)).toEqual(["b", "c"]);
    expect((result.failed[0].error as Error).message).toBe("boom");
    expect(result.failed[1].error).toBeUndefined();
  });

  it("never runs more than `concurrency` operations at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runBulk(
      items,
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return true;
      },
      { concurrency: 3 },
    );
    expect(maxInFlight).toBe(3);
  });
});
