import { describe, expect, it } from "vitest";
import { compactTokens, formatCost, formatDurationMs } from "@/web-app/utils/format";

describe("compactTokens", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1k"],
    [12_349, "12.3k"],
  ])("formats %i as %s", (value, expected) => {
    expect(compactTokens(value)).toBe(expected);
  });
});

describe("formatDurationMs", () => {
  it.each([
    [0, "0 ms"],
    [820, "820 ms"],
    [1_500, "1.5 s"],
    [90_000, "1.5 min"],
    [7_200_000, "2 hr"],
  ])("formats %i ms as %s", (value, expected) => {
    expect(formatDurationMs(value)).toBe(expected);
  });

  it("uses a dash when timing is unavailable", () => {
    expect(formatDurationMs(undefined)).toBe("—");
  });
});

describe("formatCost", () => {
  it("keeps useful precision for small model costs", () => {
    expect(formatCost({ amount: 0.004321, currency: "USD" })).toBe("USD 0.0043");
  });

  it("shows zero-cost local inference explicitly", () => {
    expect(formatCost({ amount: 0, currency: "USD" })).toBe("USD 0.0000");
  });

  it("uses a dash when cost is unknown", () => {
    expect(formatCost(undefined)).toBe("—");
  });
});
