import { describe, expect, it } from "vitest";

import { compareSortValues, sortByField } from "./comparators";

describe("compareSortValues", () => {
  it("sorts strings alphanumerically", () => {
    expect(compareSortValues("item-2", "item-10")).toBeLessThan(0);
  });

  it("sorts numbers and dates numerically", () => {
    expect(compareSortValues(2, 10)).toBeLessThan(0);
    expect(compareSortValues(new Date("2024-01-01"), new Date("2024-02-01"))).toBeLessThan(0);
  });

  it("treats invalid numeric values as empty strings", () => {
    expect(compareSortValues(Number.NaN, 1)).toBeLessThan(0);
    expect(compareSortValues(new Date("not-a-date"), 1)).toBeLessThan(0);
  });
});

describe("sortByField", () => {
  const items = [
    { name: "b", count: 2 },
    { name: "a", count: 10 },
  ];

  it("sorts ascending and descending by selector", () => {
    const selectors = {
      name: (item: (typeof items)[number]) => item.name,
      count: (item: (typeof items)[number]) => item.count,
    };
    expect(sortByField(items, { field: "name", dir: "asc" }, selectors).map((item) => item.name)).toEqual(["a", "b"]);
    expect(sortByField(items, { field: "count", dir: "desc" }, selectors).map((item) => item.count)).toEqual([10, 2]);
  });

  it("returns the same array reference without an active selector", () => {
    expect(sortByField(items, undefined, {})).toBe(items);
    expect(sortByField(items, { field: "missing", dir: "asc" }, {})).toBe(items);
  });
});
