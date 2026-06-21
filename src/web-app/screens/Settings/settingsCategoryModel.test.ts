import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS_CATEGORY_ID,
  resolveSettingsCategoryId,
  SETTINGS_CATEGORIES,
} from "@/web-app/screens/Settings/settingsCategoryModel";

describe("settingsCategoryModel", () => {
  it("exposes the settings categories in display order", () => {
    expect(SETTINGS_CATEGORIES.map((c) => c.id)).toEqual([
      "ai",
      "appearance",
      "config",
      "logging",
      "network",
      "startup",
    ]);
  });

  it("gives every category a non-empty title and an icon", () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(category.title.trim().length).toBeGreaterThan(0);
      expect(category.icon.length).toBeGreaterThan(0);
    }
  });

  it("has unique category ids", () => {
    const ids = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defaults to the first category", () => {
    expect(DEFAULT_SETTINGS_CATEGORY_ID).toBe(SETTINGS_CATEGORIES[0].id);
    expect(DEFAULT_SETTINGS_CATEGORY_ID).toBe("ai");
  });

  it("resolves valid deep-link categories and falls back for unknown ones", () => {
    expect(resolveSettingsCategoryId("config")).toBe("config");
    expect(resolveSettingsCategoryId("network")).toBe("network");
    expect(resolveSettingsCategoryId("nope")).toBe(DEFAULT_SETTINGS_CATEGORY_ID);
    expect(resolveSettingsCategoryId(undefined)).toBe(DEFAULT_SETTINGS_CATEGORY_ID);
  });
});
