import { describe, expect, it } from "vitest";

import { updateLogLevel } from "./settingsUpdate";

// A settings UPDATE must only (re)apply the log level when the caller explicitly provides one. A
// partial update that doesn't touch logging (the wizard opt-out write, makePrimary's connector-only
// write) must leave the running level untouched — the old `|| "warn"` fallback silently reset it.
// Boot-time defaulting to "warn" is a separate path (appStore.initialize) and is intentionally kept.
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
