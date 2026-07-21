import { describe, expect, it } from "vitest";

import { schemeNeedsSecret } from "./auth";

describe("schemeNeedsSecret", () => {
  it("is false only for the 'none' scheme", () => {
    expect(schemeNeedsSecret("none")).toBe(false);
  });

  it("is true for bearer, basic and header (each carries a secret)", () => {
    expect(schemeNeedsSecret("bearer")).toBe(true);
    expect(schemeNeedsSecret("basic")).toBe(true);
    expect(schemeNeedsSecret("header")).toBe(true);
  });
});
