import { describe, expect, it } from "vitest";

import { normalizeWizardSettings, shouldShowAtStartup } from "./wizardSettings";

describe("shouldShowAtStartup", () => {
  it("does NOT show while settings are still loading (undefined wizard) — avoids the every-boot race", () => {
    // undefined means user settings haven't loaded yet; showing here is exactly the every-launch bug.
    expect(shouldShowAtStartup(undefined, true, false)).toBe(false);
  });
  it("shows once on a genuinely fresh (loaded) config with no first-run marker", () => {
    expect(shouldShowAtStartup({ skipAtStartup: false }, true, false)).toBe(true);
  });
  it("does not show again once the first run has been handled", () => {
    expect(shouldShowAtStartup({ skipAtStartup: false, firstRunHandledAt: "2026-07-03T00:00:00Z" }, true, false)).toBe(
      false,
    );
  });
  it("does not show for existing users who opted out (back-compat)", () => {
    expect(shouldShowAtStartup({ skipAtStartup: true }, true, false)).toBe(false);
  });
  it("does not show before the app is ready", () => {
    expect(shouldShowAtStartup({ skipAtStartup: false }, false, false)).toBe(false);
  });
  it("does not show twice in one session", () => {
    expect(shouldShowAtStartup({ skipAtStartup: false }, true, true)).toBe(false);
  });
});

describe("normalizeWizardSettings", () => {
  it("defaults skipAtStartup to false when absent (back-compat configs)", () => {
    expect(normalizeWizardSettings(undefined)).toEqual({ skipAtStartup: false });
  });
  it("preserves provided fields", () => {
    expect(normalizeWizardSettings({ skipAtStartup: true, lastCompletedVersion: "5.3.16" })).toEqual({
      skipAtStartup: true,
      lastCompletedVersion: "5.3.16",
    });
  });
});
