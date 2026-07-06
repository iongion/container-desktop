// Pure version-string transforms shared by the release commands. Every function takes file
// *contents* and returns new contents; all file IO, git and network side effects live in the
// command layer. Keeping these pure makes the fiddly rules — the version embedded in
// package.json `main` (a path), the docs cache-busters, the per-arch homebrew hashes —
// straightforward to unit test (see __tests__/versioning.test.ts).

export const PARTS = ["major", "minor", "patch"] as const;
export type VersionPart = (typeof PARTS)[number];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Return `[major, minor, patch]` from a version string, tolerating a leading `v` and any
 * `-prerelease` / `+build` suffix. */
export function parseVersion(value: string): [number, number, number] {
  const core = value.trim().replace(/^v+/, "").split("+", 1)[0].split("-", 1)[0];
  const parts = core.split(".");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Increment `value` by `part` (`major` / `minor` / `patch`). */
export function bumpVersion(value: string, part: string = "patch"): string {
  if (!(PARTS as readonly string[]).includes(part)) {
    throw new Error(`unknown version part: ${JSON.stringify(part)} (expected one of ${PARTS.join(", ")})`);
  }
  const [major, minor, patch] = parseVersion(value);
  if (part === "major") {
    return `${major + 1}.0.0`;
  }
  if (part === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function replaceJsonStringValue(text: string, key: string, value: string): string {
  const pattern = new RegExp(`("${escapeRegExp(key)}":\\s*")[^"]*(")`);
  return text.replace(pattern, (_match, prefix, suffix) => `${prefix}${value}${suffix}`);
}

/** Update `version` and the version embedded in `main` (a path segment). */
export function setPackageJsonVersion(text: string, version: string): string {
  const withVersion = replaceJsonStringValue(text, "version", version);
  return withVersion.replace(
    /("main":\s*"build\/)[^/]*(\/main\.cjs")/,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
}

/** Update the `version` field, leaving `manifest_version` untouched. */
export function setManifestVersion(text: string, version: string): string {
  return replaceJsonStringValue(text, "version", version);
}

/** Update the Tauri `version` field AND the version embedded in `frontendDist`
 * (`../build/<version>`, the versioned renderer output dir — same pattern as package.json `main`). */
export function setTauriConfVersion(text: string, version: string): string {
  const withVersion = replaceJsonStringValue(text, "version", version);
  return withVersion.replace(
    /("frontendDist":\s*"\.\.\/build\/)[^/"]*(")/,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
}

/** Update the `[package]` crate version in a Cargo.toml — the first line-anchored `version = "..."`,
 * which is always the package version ([package] leads the file). Dependency constraints (inline or
 * under `[dependencies.*]` sub-tables) come later and are left untouched. */
export function setCargoTomlVersion(text: string, version: string): string {
  return text.replace(/^version = "[^"]*"/m, `version = "${version}"`);
}

/** Replace a plaintext VERSION file body, preserving a trailing newline. */
export function setPlainVersion(text: string, version: string): string {
  const suffix = text.endsWith("\n") ? "\n" : "";
  return `${version}${suffix}`;
}

/** Insert a dated `[version]` section under `[Unreleased]`. No-op without an `## [Unreleased]` heading. */
export function promoteChangelog(text: string, version: string, today: string): string {
  const marker = "## [Unreleased]";
  if (!text.includes(marker)) {
    return text;
  }
  return text.replace(marker, `${marker}\n\n## [${version}] - ${today}`);
}

/** Return only the changelog body for `version`. Accepts both `## [1.2.3] - date` and
 * `## 1.2.3 - date` headings and stops at the next level-2 heading. Throws when the section is
 * missing or empty (the bump guard relies on the empty-section throw, passing "Unreleased"). */
export function extractChangelogSection(text: string, version: string): string {
  const escapedVersion = escapeRegExp(version);
  const heading = new RegExp(`^##\\s+(?:\\[${escapedVersion}\\]|${escapedVersion})(?:\\s+-[^\\n]*)?\\s*$`, "m");
  const match = heading.exec(text);
  if (!match) {
    throw new Error(`CHANGELOG.md has no section for ${version}`);
  }

  const rest = text.slice(match.index + match[0].length);
  const nextHeading = /^##\s+(?:\[?(?:Unreleased|\d+\.\d+\.\d+(?:[-+][^\]\s]+)?)\]?)(?:\s+-[^\n]*)?\s*$/m.exec(rest);
  const body = rest.slice(0, nextHeading ? nextHeading.index : undefined).trim();
  if (!body) {
    throw new Error(`CHANGELOG.md section for ${version} is empty`);
  }
  return `${body}\n`;
}

/** Point the website download page at `version`. The current version is read from the
 * `data-version` attribute and every literal occurrence is rewritten — this covers
 * `data-version`, the `?v=x.y.z[.n]` asset cache-busters and the release download URLs. */
export function setWebsiteVersion(text: string, version: string): string {
  const match = /data-version="([^"]+)"/.exec(text);
  if (!match) {
    throw new Error("docs page has no data-version attribute");
  }
  const current = match[1];
  if (current === version) {
    return text;
  }
  return text.replaceAll(current, version);
}

/** Update the cask `version` and its `sha256` (arm64-only). The download URL uses `#{version}`
 * interpolation so it needs no change. */
export function renderHomebrewRb(text: string, version: string, shaArm: string): string {
  const withVersion = text.replace(/(version\s+")[^"]*(")/, (_match, prefix, suffix) => `${prefix}${version}${suffix}`);
  return withVersion.replace(/(sha256\s+")[^"]*(")/, (_match, prefix, suffix) => `${prefix}${shaArm}${suffix}`);
}
