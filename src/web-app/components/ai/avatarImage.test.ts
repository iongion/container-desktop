import { describe, expect, it } from "vitest";
import { fitDimensions } from "./avatarImage";

describe("fitDimensions", () => {
  it("scales the longer side to max, preserving aspect", () => {
    expect(fitDimensions(400, 200, 128)).toEqual({ width: 128, height: 64 });
    expect(fitDimensions(100, 300, 128)).toEqual({ width: 43, height: 128 });
  });
  it("never upscales", () => {
    expect(fitDimensions(50, 40, 128)).toEqual({ width: 50, height: 40 });
  });
});
