import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("screenshots manifest", () => {
  it("deep-links the settings screenshot to the configuration section", () => {
    const manifest = readFileSync(path.resolve("support/screenshots.manifest.mjs"), "utf8");
    const userSettingsEntry = manifest.match(/\{\s*file:\s*"UserSettings\.png",[\s\S]*?\n\s*\}/)?.[0] ?? "";

    expect(userSettingsEntry).toContain('route: "/screens/settings/user-settings?category=config"');
    expect(userSettingsEntry).toContain('waitFor: \'[data-screen="settings-settings"] [data-form="configuration"]\'');
  });
});
