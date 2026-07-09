import { describe, expect, it } from "vitest";

import { updateLogLevel } from "./settingsUpdate";

describe("updateLogLevel", () => {
  it("returns the explicit level when logging.level is provided", () => {
    expect(updateLogLevel({ logging: { level: "debug" } as any })).toBe("debug");
  });

  it("returns undefined for a wizard-only update so the running level is not reset", () => {
    expect(updateLogLevel({ wizard: { skipAtStartup: true } })).toBeUndefined();
  });

  it("returns undefined when logging is present but carries no level", () => {
    expect(updateLogLevel({ logging: {} as any })).toBeUndefined();
  });

  it("returns undefined for an empty update", () => {
    expect(updateLogLevel({})).toBeUndefined();
  });
});
