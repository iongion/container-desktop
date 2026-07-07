import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  extractChangelogSection,
  parseVersion,
  promoteChangelog,
  renderHomebrewRb,
  setCargoTomlVersion,
  setManifestVersion,
  setPackageJsonVersion,
  setPlainVersion,
  setTauriConfMetadata,
  setTauriConfVersion,
  setWebsiteVersion,
} from "@/cli/lib/versioning";

describe("parseVersion", () => {
  it("parses a basic version", () => {
    expect(parseVersion("5.2.15")).toEqual([5, 2, 15]);
  });

  it("ignores a prerelease suffix", () => {
    expect(parseVersion("5.2.2-rc.8")).toEqual([5, 2, 2]);
  });
});

describe("bumpVersion", () => {
  it("bumps the patch", () => {
    expect(bumpVersion("5.2.15", "patch")).toBe("5.2.16");
  });

  it("defaults to patch", () => {
    expect(bumpVersion("5.2.15")).toBe("5.2.16");
  });

  it("bumps minor and resets patch", () => {
    expect(bumpVersion("5.2.15", "minor")).toBe("5.3.0");
  });

  it("bumps major and resets minor and patch", () => {
    expect(bumpVersion("5.2.15", "major")).toBe("6.0.0");
  });

  it("rejects an unknown part", () => {
    expect(() => bumpVersion("5.2.15", "huge")).toThrow();
  });
});

describe("setPackageJsonVersion", () => {
  it("updates version and the version embedded in main, leaving dependency pins", () => {
    const text = [
      "{",
      '  "name": "container-desktop",',
      '  "version": "5.2.15",',
      '  "main": "build/5.2.15/main.cjs",',
      '  "dependencies": {',
      '    "react": "19.2.7"',
      "  }",
      "}",
      "",
    ].join("\n");
    const out = setPackageJsonVersion(text, "5.2.16");
    expect(out).toContain('"version": "5.2.16"');
    expect(out).toContain('"main": "build/5.2.16/main.cjs"');
    expect(out).toContain('"react": "19.2.7"');
  });
});

describe("setManifestVersion", () => {
  it("leaves the manifest_version key alone", () => {
    const text = '{\n  "manifest_version": 2,\n  "name": "Container Desktop",\n  "version": "5.2.15"\n}\n';
    const out = setManifestVersion(text, "5.2.16");
    expect(out).toContain('"manifest_version": 2');
    expect(out).toContain('"version": "5.2.16"');
  });
});

describe("setTauriConfVersion", () => {
  it("updates version AND the version embedded in frontendDist, leaving other keys", () => {
    const text = [
      "{",
      '  "productName": "Container Desktop",',
      '  "version": "5.2.15",',
      '  "identifier": "com.iongion.container-desktop.tauri",',
      '  "build": {',
      '    "frontendDist": "../build/5.2.15",',
      '    "devUrl": "http://localhost:3000"',
      "  }",
      "}",
      "",
    ].join("\n");
    const out = setTauriConfVersion(text, "6.0.0");
    expect(out).toContain('"version": "6.0.0"');
    expect(out).toContain('"frontendDist": "../build/6.0.0"');
    expect(out).toContain('"identifier": "com.iongion.container-desktop.tauri"');
    expect(out).toContain('"devUrl": "http://localhost:3000"');
  });
});

describe("setTauriConfMetadata", () => {
  it("syncs productName, identifier and window title from the shared metadata, leaving version + geometry", () => {
    const text = [
      "{",
      '  "productName": "Old Product",',
      '  "version": "6.0.0",',
      '  "identifier": "com.old.id",',
      '  "app": {',
      '    "windows": [',
      "      {",
      '        "label": "main",',
      '        "title": "Old Product",',
      '        "width": 1280,',
      '        "backgroundColor": "#171c26"',
      "      }",
      "    ]",
      "  }",
      "}",
      "",
    ].join("\n");
    const out = setTauriConfMetadata(text, {
      product: "Container Desktop",
      identifier: "com.iongion.container-desktop.tauri",
    });
    expect(out).toContain('"productName": "Container Desktop"');
    expect(out).toContain('"identifier": "com.iongion.container-desktop.tauri"');
    expect(out).toContain('"title": "Container Desktop"');
    // version + window geometry must be untouched
    expect(out).toContain('"version": "6.0.0"');
    expect(out).toContain('"width": 1280');
    expect(out).toContain('"backgroundColor": "#171c26"');
    expect(out).not.toContain("Old Product");
    expect(out).not.toContain("com.old.id");
  });
});

describe("setCargoTomlVersion", () => {
  it("updates the [package] version, leaving dependency version constraints", () => {
    const text = [
      "[package]",
      'name = "container-desktop"',
      'version = "5.2.15"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'tauri = { version = "2", features = ["tray-icon"] }',
      "",
      "[dependencies.serde]",
      'version = "1.0"',
      "",
    ].join("\n");
    const out = setCargoTomlVersion(text, "6.0.0");
    expect(out).toContain('version = "6.0.0"');
    // dependency constraints must be untouched
    expect(out).toContain('tauri = { version = "2", features = ["tray-icon"] }');
    expect(out).toContain('version = "1.0"');
    expect(out).not.toContain('version = "5.2.15"');
  });
});

describe("setPlainVersion", () => {
  it("replaces the content and keeps a trailing newline", () => {
    expect(setPlainVersion("5.2.14\n", "5.2.15")).toBe("5.2.15\n");
  });

  it("preserves the absence of a trailing newline", () => {
    expect(setPlainVersion("5.2.14", "5.2.15")).toBe("5.2.15");
  });
});

describe("promoteChangelog", () => {
  it("inserts a dated section after Unreleased", () => {
    const text = "# Changelog\n\n## [Unreleased]\n\n## Added\n\n- Something\n";
    const out = promoteChangelog(text, "5.2.16", "2026-06-13");
    expect(out).toContain("## [Unreleased]\n\n## [5.2.16] - 2026-06-13\n");
    expect(out).toContain("- Something");
  });

  it("is a no-op without an Unreleased heading", () => {
    const text = "# Changelog\n\n## [5.2.15] - 2026-01-01\n";
    expect(promoteChangelog(text, "5.2.16", "2026-06-13")).toBe(text);
  });
});

describe("extractChangelogSection", () => {
  it("returns only the requested version body", () => {
    const text = [
      "# Changelog\n",
      "## [Unreleased]\n",
      "- Later\n",
      "## [5.2.16] - 2026-06-14\n",
      "Intro.\n",
      "## Added\n",
      "- One\n",
      "## 5.2.15 - 2025-04-01\n",
      "- Previous\n",
    ].join("\n");
    const out = extractChangelogSection(text, "5.2.16");
    expect(out).toBe("Intro.\n\n## Added\n\n- One\n");
    expect(out).not.toContain("Unreleased");
    expect(out).not.toContain("5.2.15");
  });

  it("rejects a missing version", () => {
    expect(() => extractChangelogSection("# Changelog\n\n## [5.2.15] - 2026-01-01\n", "5.2.16")).toThrow(/no section/);
  });

  it("raises on an empty Unreleased section (the bump guard relies on this)", () => {
    const text = "# Changelog\n\n## [Unreleased]\n\n## [5.3.0] - 2026-06-15\n\n- Shipped\n";
    expect(() => extractChangelogSection(text, "Unreleased")).toThrow(/empty/);
  });

  it("returns the Unreleased body when present", () => {
    const text = "# Changelog\n\n## [Unreleased]\n\n## Added\n\n- New thing\n\n## [5.3.0] - 2026-06-15\n\n- Shipped\n";
    const out = extractChangelogSection(text, "Unreleased");
    expect(out).toContain("## Added");
    expect(out).toContain("- New thing");
    expect(out).not.toContain("5.3.0");
  });
});

describe("setWebsiteVersion", () => {
  it("updates data-version, cache-buster and download URLs", () => {
    const text = [
      '<html lang="en" data-version="5.2.13">',
      '<link rel="stylesheet" href="./css/common.css?v=5.2.13.3" />',
      '<a href="https://github.com/iongion/container-desktop/releases/download/5.2.13/container-desktop-x86_64-5.2.13.AppImage">AppImage</a>',
      "",
    ].join("\n");
    const out = setWebsiteVersion(text, "5.2.16");
    expect(out).toContain('data-version="5.2.16"');
    expect(out).toContain("common.css?v=5.2.16.3");
    expect(out).toContain("releases/download/5.2.16/container-desktop-x86_64-5.2.16.AppImage");
    expect(out).not.toContain("5.2.13");
  });

  it("is a no-op when already current", () => {
    const text = '<html lang="en" data-version="5.2.16">\n';
    expect(setWebsiteVersion(text, "5.2.16")).toBe(text);
  });
});

describe("renderHomebrewRb", () => {
  it("updates the version and sha256, preserving url interpolation", () => {
    const text = [
      'cask "container-desktop" do',
      "",
      '  version "5.2.15"',
      '  sha256 "aaa111"',
      "",
      '  url "https://github.com/iongion/container-desktop/releases/container-desktop-mac-arm64-#{version}.dmg"',
      "end",
      "",
    ].join("\n");
    const out = renderHomebrewRb(text, "5.2.16", "ccc333");
    expect(out).toContain('version "5.2.16"');
    expect(out).toContain('"ccc333"');
    expect(out).toContain("container-desktop-mac-arm64-#{version}.dmg");
    expect(out).not.toContain("5.2.15");
    expect(out).not.toContain("aaa111");
  });
});
