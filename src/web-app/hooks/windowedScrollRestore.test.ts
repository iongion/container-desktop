import { describe, expect, it } from "vitest";

import { canRestoreScrollOffset, estimateWindowedContentHeight } from "./windowedScrollRestore";

// Mirrors the container list's row shape: group headers are taller than member rows.
type Row = { kind: "group-header" | "container" };
const estimate = (row: Row): number => (row.kind === "group-header" ? 34 : 28);
const container = (): Row => ({ kind: "container" });
const header = (): Row => ({ kind: "group-header" });

describe("estimateWindowedContentHeight", () => {
  it("reserves nothing for an empty list", () => {
    expect(estimateWindowedContentHeight([], estimate)).toBe(0);
  });

  it("falls back to the default row height when no estimator is given", () => {
    expect(estimateWindowedContentHeight([container(), container(), container()])).toBe(84);
  });

  it("sums the per-row estimate across mixed heights (headers + members)", () => {
    // 1 header (34) + 3 members (3 * 28) = 118
    expect(estimateWindowedContentHeight([header(), container(), container(), container()], estimate)).toBe(118);
  });
});

describe("canRestoreScrollOffset", () => {
  it("restores an offset the content can still reach", () => {
    expect(canRestoreScrollOffset(800, 2800)).toBe(true);
  });

  it("always restores the top (offset 0)", () => {
    expect(canRestoreScrollOffset(0, 0)).toBe(true);
    expect(canRestoreScrollOffset(0, 840)).toBe(true);
  });

  it("keeps an offset exactly at the content height (clamps harmlessly to the bottom)", () => {
    expect(canRestoreScrollOffset(2800, 2800)).toBe(true);
  });

  it("DROPS a stale offset that overshoots the shrunk content (the disconnect regression)", () => {
    // Saved near the bottom of a 100-row multi-engine list (~2800px); on return only ~30 docker rows
    // remain (~840px). Restoring 2800 would window every row out of view -> big empty gap at the top.
    expect(canRestoreScrollOffset(2800, 840)).toBe(false);
  });
});

describe("scroll-restoration regression scenario (end to end, pure)", () => {
  const estimateRowHeight = estimate;

  it("rejects the saved offset when the merged list shrank after a disconnect", () => {
    const savedOffset = 2800;
    const shrunkRows: Row[] = [header(), ...Array.from({ length: 29 }, container)]; // docker only now
    const contentHeight = estimateWindowedContentHeight(shrunkRows, estimateRowHeight);
    expect(canRestoreScrollOffset(savedOffset, contentHeight)).toBe(false);
  });

  it("preserves the saved offset for a normal list -> detail -> back (same list)", () => {
    const savedOffset = 2800;
    const sameRows: Row[] = [header(), ...Array.from({ length: 120 }, container)];
    const contentHeight = estimateWindowedContentHeight(sameRows, estimateRowHeight);
    expect(canRestoreScrollOffset(savedOffset, contentHeight)).toBe(true);
  });
});
