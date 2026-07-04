import { describe, expect, it } from "vitest";

import { DEFAULT_LOGGING_FILE, normalizeLoggingFileSettings } from "@/platform/logger/loggingSettings";

describe("normalizeLoggingFileSettings", () => {
  it("defaults to opt-in OFF with conservative caps when nothing is stored", () => {
    expect(normalizeLoggingFileSettings(undefined)).toEqual(DEFAULT_LOGGING_FILE);
    expect(DEFAULT_LOGGING_FILE.enabled).toBe(false);
  });

  it("coerces enabled to a boolean and fills missing fields with defaults", () => {
    expect(normalizeLoggingFileSettings({ enabled: true } as any)).toEqual({
      enabled: true,
      maxSizeMb: DEFAULT_LOGGING_FILE.maxSizeMb,
      maxFiles: DEFAULT_LOGGING_FILE.maxFiles,
    });
  });

  it("clamps out-of-range / garbage numbers back to safe values", () => {
    expect(normalizeLoggingFileSettings({ enabled: true, maxSizeMb: 0, maxFiles: -5 } as any)).toMatchObject({
      maxSizeMb: DEFAULT_LOGGING_FILE.maxSizeMb,
      maxFiles: DEFAULT_LOGGING_FILE.maxFiles,
    });
    expect(normalizeLoggingFileSettings({ enabled: true, maxSizeMb: 99999, maxFiles: 99999 } as any)).toMatchObject({
      maxSizeMb: 1024,
      maxFiles: 100,
    });
    expect(normalizeLoggingFileSettings({ maxSizeMb: "abc" } as any).maxSizeMb).toBe(DEFAULT_LOGGING_FILE.maxSizeMb);
  });
});
