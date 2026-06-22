import { describe, expect, it } from "vitest";

import { computeSpacers } from "./computeSpacers";

describe("computeSpacers", () => {
  it("reserves nothing when no rows are windowed", () => {
    expect(computeSpacers([], 0, 0)).toEqual({ paddingTop: 0, paddingBottom: 0 });
  });

  it("at the top of the list, the leading spacer cancels the sticky-header margin", () => {
    // First row starts exactly at the header height; nothing to reserve above it.
    const spacers = computeSpacers([{ start: 30, end: 58 }], 300, 30);
    expect(spacers).toEqual({ paddingTop: 0, paddingBottom: 242 });
  });

  it("mid-list, reserves the rows above (minus margin) and below the window", () => {
    const spacers = computeSpacers(
      [
        { start: 330, end: 358 },
        { start: 358, end: 386 },
      ],
      1000,
      30,
    );
    expect(spacers).toEqual({ paddingTop: 300, paddingBottom: 614 });
  });

  it("clamps a leading spacer that would go negative to 0", () => {
    expect(computeSpacers([{ start: 10, end: 40 }], 100, 30)).toEqual({ paddingTop: 0, paddingBottom: 60 });
  });

  it("clamps a trailing spacer that would go negative to 0", () => {
    expect(computeSpacers([{ start: 30, end: 120 }], 100, 30)).toEqual({ paddingTop: 0, paddingBottom: 0 });
  });
});
