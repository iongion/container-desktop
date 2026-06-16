import { describe, expect, it } from "vitest";

import { headerCheckboxState, pruneIds, toggleId } from "./selection";

describe("toggleId", () => {
  it("appends an id that is not selected", () => {
    expect(toggleId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("removes an id that is already selected, keeping order", () => {
    expect(toggleId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("pruneIds", () => {
  it("drops selected ids that are no longer visible", () => {
    expect(pruneIds(["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"]);
  });

  it("returns the same reference when nothing needs pruning (avoids re-render)", () => {
    const ids = ["a", "b"];
    expect(pruneIds(ids, ["a", "b", "c"])).toBe(ids);
  });
});

describe("headerCheckboxState", () => {
  it("is unchecked and not indeterminate when nothing is selected", () => {
    expect(headerCheckboxState(0, 5)).toEqual({ checked: false, indeterminate: false });
  });

  it("is checked when every visible row is selected", () => {
    expect(headerCheckboxState(5, 5)).toEqual({ checked: true, indeterminate: false });
  });

  it("is indeterminate on a partial selection", () => {
    expect(headerCheckboxState(2, 5)).toEqual({ checked: false, indeterminate: true });
  });

  it("is unchecked for an empty list", () => {
    expect(headerCheckboxState(0, 0)).toEqual({ checked: false, indeterminate: false });
  });
});
