import fs from "node:fs";
import path from "node:path";
import { PROJECT_HOME, REPO_SLUG, readText, writeText } from "@/cli/lib/paths";
import { capture, runEnv } from "@/cli/lib/process";
import { renderHomebrewRb } from "@/cli/lib/versioning";

// publish-meta: point the website download page and homebrew cask at a real, published release.
// The website version/URLs are baked from package.json at Eleventy build time; the cask needs a
// real per-asset sha256, so it is rendered separately here.

const HOMEBREW_CASK = "support/homebrew-cask/container-desktop.rb";

export function latestReleaseVersion(): string {
  const result = capture(`gh release view --repo ${REPO_SLUG} --json tagName --jq .tagName`, { allowFailure: true });
  const tag = (result.stdout || "").trim();
  if (!tag) {
    throw new Error("unable to resolve latest published release; pass --version");
  }
  return tag.replace(/^v+/, "");
}

// macOS ships arm64 only; read the dmg checksum from release/ if present, else the published release.
async function artifactSha256(version: string): Promise<string> {
  const name = `container-desktop-mac-arm64-${version}.dmg.sha256`;
  const local = path.join(PROJECT_HOME, "release", name);
  if (fs.existsSync(local)) {
    return fs.readFileSync(local, "utf8").trim().split(/\s+/)[0];
  }
  const url = `https://github.com/${REPO_SLUG}/releases/download/${version}/${name}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.text()).trim().split(/\s+/)[0];
}

export async function publishMeta(options: { version?: string; perform?: boolean } = {}): Promise<void> {
  const version = options.version || latestReleaseVersion();
  const perform = Boolean(options.perform);
  console.log(`Render published metadata for ${version}${perform ? "" : "  (dry-run; pass --perform)"}`);
  if (perform) {
    fs.rmSync(path.join(PROJECT_HOME, "website"), { recursive: true, force: true });
    runEnv("yarn build:website");
    console.log("  rebuilt: website/ (generated from website-src/)");
    const shaArm = await artifactSha256(version);
    writeText(HOMEBREW_CASK, renderHomebrewRb(readText(HOMEBREW_CASK), version, shaArm));
    console.log(`  updated: ${HOMEBREW_CASK}`);
  } else {
    console.log("  would rebuild: website/ (from website-src/) via build-website");
    console.log(`  would update: ${HOMEBREW_CASK} (fetch dmg sha256 for arm64)`);
  }
}
