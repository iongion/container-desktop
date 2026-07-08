import { describe, expect, it } from "vitest";

import { emptySystemDf, summarizeSystemDf } from "./systemDf";

// Fixtures mirror the REAL shapes captured from the live engines (docker /system/df, libpod /system/df).
describe("summarizeSystemDf — docker", () => {
  const raw = {
    LayersSize: 12166698163,
    Images: [
      { Containers: 0, Size: 193265711, SharedSize: 12973693 }, // unused → reclaimable (Size - SharedSize)
      { Containers: 4, Size: 176940861, SharedSize: 32 }, // in use → not reclaimable
    ],
  };

  it("uses LayersSize as the total and reclaims unique bytes of unused images", () => {
    const df = summarizeSystemDf(raw, true);
    expect(df.imagesSize).toBe(12166698163);
    expect(df.imagesReclaimable).toBe(193265711 - 12973693);
    expect(df.imagesCount).toBe(2);
    expect(df.reclaimableCount).toBe(1);
  });
});

describe("summarizeSystemDf — libpod", () => {
  const raw = {
    ImagesSize: 701494003,
    Images: [
      { Containers: 1, UniqueSize: 120227625 }, // in use
      { Containers: 0, UniqueSize: 17624 }, // unused → reclaimable
      { Containers: 0, UniqueSize: 9725 }, // unused → reclaimable
    ],
  };

  it("uses ImagesSize as the total and reclaims UniqueSize of unused images", () => {
    const df = summarizeSystemDf(raw, false);
    expect(df.imagesSize).toBe(701494003);
    expect(df.imagesReclaimable).toBe(17624 + 9725);
    expect(df.reclaimableCount).toBe(2);
    expect(df.imagesCount).toBe(3);
  });
});

describe("summarizeSystemDf — edges", () => {
  it("falls back to the sum of unique sizes when no declared total is present", () => {
    const df = summarizeSystemDf({ Images: [{ Containers: 0, Size: 100, SharedSize: 30 }] }, true);
    expect(df.imagesSize).toBe(70);
  });

  it("never returns a negative reclaimable and tolerates missing/garbage input", () => {
    expect(summarizeSystemDf({ Images: [{ Containers: 0, Size: 5, SharedSize: 99 }] }, true).imagesReclaimable).toBe(0);
    expect(summarizeSystemDf(null, true)).toEqual(emptySystemDf());
    expect(summarizeSystemDf({}, false)).toEqual(emptySystemDf());
  });
});
