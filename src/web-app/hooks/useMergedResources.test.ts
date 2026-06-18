import { describe, expect, it } from "vitest";

import { resolveShowEngineColumn } from "./useMergedResources";

describe("resolveShowEngineColumn", () => {
  it("keeps the engine column hidden by default", () => {
    expect(resolveShowEngineColumn(true, undefined)).toBe(false);
    expect(resolveShowEngineColumn(true, false)).toBe(false);
  });

  it("shows the engine column only when unified mode and the user setting are both enabled", () => {
    expect(resolveShowEngineColumn(false, true)).toBe(false);
    expect(resolveShowEngineColumn(true, true)).toBe(true);
  });
});
