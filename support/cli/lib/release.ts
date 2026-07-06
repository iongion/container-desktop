import { commitRelease } from "@/cli/lib/git";
import { readSourceVersion, readText, writeText } from "@/cli/lib/paths";
import {
  bumpVersion,
  extractChangelogSection,
  promoteChangelog,
  setCargoTomlVersion,
  setManifestVersion,
  setPackageJsonVersion,
  setPlainVersion,
  setTauriConfVersion,
} from "@/cli/lib/versioning";

// Versioning orchestration for the bump / version-sync commands. package.json `version` is the single
// source of truth; VERSION, public/manifest.json and the Tauri manifests (tauri.conf.json + Cargo.toml)
// are the derived "synced" files — the Rust shell must build at the same version the release publishes.

/** package.json (source of truth) + the files derived from it, rendered at `version`. */
export function syncedTargets(version: string): Array<[string, string]> {
  return [
    ["package.json", setPackageJsonVersion(readText("package.json"), version)],
    ["VERSION", setPlainVersion(readText("VERSION"), version)],
    ["public/manifest.json", setManifestVersion(readText("public/manifest.json"), version)],
    ["src-tauri/tauri.conf.json", setTauriConfVersion(readText("src-tauri/tauri.conf.json"), version)],
    ["src-tauri/Cargo.toml", setCargoTomlVersion(readText("src-tauri/Cargo.toml"), version)],
  ];
}

/** Print the plan (dry-run) or write each changed file, mirroring tasks.py `_apply`. */
export function applyTargets(targets: Array<[string, string]>, perform: boolean): void {
  let changed = 0;
  for (const [rel, newContent] of targets) {
    if (readText(rel) === newContent) {
      console.log(`  = ${rel}`);
      continue;
    }
    changed += 1;
    console.log(`  ${perform ? "updated" : "would update"}: ${rel}`);
    if (perform) {
      writeText(rel, newContent);
    }
  }
  console.log(`${changed} file(s) ${perform ? "updated" : "pending"}`);
}

/** Write the source version into all synced files (drift repair, no bump). */
export function runVersionSync(options: { version?: string; perform?: boolean } = {}): void {
  const version = options.version || readSourceVersion();
  console.log(`Sync synced files to ${version}${options.perform ? "" : "  (dry-run; pass --perform)"}`);
  applyTargets(syncedTargets(version), Boolean(options.perform));
}

/** Bump the version everywhere and (with perform) commit, tag and push. Refuses to run when the
 * CHANGELOG [Unreleased] section is empty — a release must document something. */
export function runBump(options: { part?: string; perform?: boolean; commit?: boolean } = {}): void {
  const part = options.part || "patch";
  const perform = Boolean(options.perform);
  const commit = options.commit !== false;

  try {
    extractChangelogSection(readText("CHANGELOG.md"), "Unreleased");
  } catch (error) {
    throw new Error(`Refusing to bump: ${(error as Error).message} -- add entries to the [Unreleased] section first.`);
  }

  const current = readSourceVersion();
  const version = bumpVersion(current, part);
  console.log(`Bump ${current} -> ${version} (${part})${perform ? "" : "  (dry-run; pass --perform)"}`);

  const today = new Date().toISOString().slice(0, 10);
  const targets = syncedTargets(version);
  targets.push(["CHANGELOG.md", promoteChangelog(readText("CHANGELOG.md"), version, today)]);
  applyTargets(targets, perform);

  if (!perform) {
    console.log(`Re-run with --perform to write files${commit ? "" : " (--no-commit writes files only)"}.`);
    return;
  }
  if (!commit) {
    console.log(
      `Wrote bumped files for ${version}; skipping git (--no-commit) -- finish with \`yarn cli commit-release\`.`,
    );
    return;
  }
  commitRelease(version);
}
