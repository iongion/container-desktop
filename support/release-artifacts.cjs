const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const APP_NAME = "container-desktop";
const DEFAULT_REPO = "iongion/container-desktop";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const WINDOWS_INSTALLER_WRAPPER = `${APP_NAME}-installer.exe`;
const LEGACY_WINDOWS_INSTALLER_CHECKSUM = `${APP_NAME}-installer.sha256`;

function artifactName(platform, arch, version, ext) {
  const platformPart = platform ? `${platform}-` : "";
  return `${APP_NAME}-${platformPart}${arch}-${version}.${ext}`;
}

function linuxArtifactName(arch, version, ext) {
  return artifactName("linux", arch, version, ext);
}

function macArtifactName(arch, version, ext) {
  return artifactName("mac", arch, version, ext);
}

function winArtifactName(arch, version, ext) {
  return artifactName("", arch, version, ext);
}

function stripChecksumExtension(name) {
  return name.endsWith(".sha256") ? name.slice(0, -".sha256".length) : name;
}

function assetBelongsToRelease(name, version) {
  if (
    name === WINDOWS_INSTALLER_WRAPPER ||
    name === `${WINDOWS_INSTALLER_WRAPPER}.sha256` ||
    name === LEGACY_WINDOWS_INSTALLER_CHECKSUM
  ) {
    return true;
  }

  const unchecksummed = stripChecksumExtension(name);
  return unchecksummed.includes(`-${version}.`) || unchecksummed.includes(`-${version}-`);
}

function isWindowsBuilderInstallerAsset(name, version) {
  const unchecksummed = stripChecksumExtension(name);
  const privateWindowsAssets = new Set();
  for (const arch of ["x64", "arm64"]) {
    privateWindowsAssets.add(winArtifactName(arch, version, "exe"));
    privateWindowsAssets.add(`${winArtifactName(arch, version, "exe")}.blockmap`);
    privateWindowsAssets.add(winArtifactName(arch, version, "appx"));
    privateWindowsAssets.add(winArtifactName(arch, version, "msix"));
  }
  return privateWindowsAssets.has(unchecksummed);
}

function isBlockmapAsset(name) {
  return stripChecksumExtension(name).endsWith(".blockmap");
}

function isPublicReleaseAsset(name, version) {
  return (
    name.startsWith(APP_NAME) &&
    assetBelongsToRelease(name, version) &&
    !isBlockmapAsset(name) &&
    !isWindowsBuilderInstallerAsset(name, version)
  );
}

function publicReleaseAssets(releaseDir, version) {
  if (!fs.existsSync(releaseDir)) {
    return [];
  }
  return fs
    .readdirSync(releaseDir)
    .filter((name) => fs.statSync(path.join(releaseDir, name)).isFile())
    .filter((name) => isPublicReleaseAsset(name, version))
    .sort()
    .map((name) => path.join(releaseDir, name));
}

function skippedReleaseAssets(releaseDir, version) {
  if (!fs.existsSync(releaseDir)) {
    return [];
  }
  return fs
    .readdirSync(releaseDir)
    .filter((name) => fs.statSync(path.join(releaseDir, name)).isFile())
    .filter(
      (name) =>
        name.startsWith(APP_NAME) && assetBelongsToRelease(name, version) && !isPublicReleaseAsset(name, version),
    )
    .sort();
}

function extractChangelogSection(text, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// Write the bare-hex `<file>.sha256` sidecar for a single freshly built artifact. Each Tauri packager
// calls this as it finishes a file, so building one `package:tauri:*` script by hand yields the same
// artifact+checksum pairs the full release sweep (writeChecksums) and CI already produce — without a
// separate `yarn cli checksums` pass. Same format as writeChecksums (64-char hex digest, no newline).
function writeChecksum(filePath) {
  const checksumPath = `${filePath}.sha256`;
  fs.writeFileSync(checksumPath, sha256File(filePath), "utf8");
  return checksumPath;
}

function writeChecksums(releaseDir, version) {
  const written = [];
  if (!fs.existsSync(releaseDir)) {
    return written;
  }
  for (const name of fs.readdirSync(releaseDir).sort()) {
    const asset = path.join(releaseDir, name);
    if (!fs.statSync(asset).isFile() || name.endsWith(".sha256") || !assetBelongsToRelease(name, version)) {
      continue;
    }
    const checksumFile = `${asset}.sha256`;
    fs.writeFileSync(checksumFile, sha256File(asset), "utf8");
    written.push(checksumFile);
  }
  return written;
}

function readSourceVersion(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
}

function releaseNotesBody(rootDir, version) {
  return `# Changelog\n\n${extractChangelogSection(fs.readFileSync(path.join(rootDir, "CHANGELOG.md"), "utf8"), version)}`;
}

function writeReleaseNotes(rootDir, releaseDir, version) {
  const notesPath = path.join(releaseDir, `release-notes-${version}.md`);
  fs.writeFileSync(notesPath, releaseNotesBody(rootDir, version), "utf8");
  return notesPath;
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || PROJECT_ROOT,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit",
  });
  if (options.allowFailure) {
    return result;
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function splitRunIds(value) {
  return `${value || ""}`
    .replaceAll(",", " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function downloadWorkflowArtifacts({ repo, runIds, releaseDir }) {
  const copied = [];
  for (const runId of runIds) {
    const downloadDir = path.join(releaseDir, `_workflow-${runId}`);
    fs.rmSync(downloadDir, { recursive: true, force: true });
    runCommand("gh", ["run", "download", runId, "--repo", repo, "--dir", downloadDir]);
    for (const src of walkFiles(downloadDir).sort()) {
      const name = path.basename(src);
      if (!name.startsWith(APP_NAME)) {
        continue;
      }
      const dest = path.join(releaseDir, name);
      fs.copyFileSync(src, dest);
      copied.push(dest);
    }
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
  return copied;
}

function releaseExists(repo, version) {
  return (
    runCommand("gh", ["release", "view", version, "--repo", repo], { allowFailure: true, quiet: true }).status === 0
  );
}

function uploadRelease({ repo, version, title, notesPath, assets, clobber }) {
  if (releaseExists(repo, version)) {
    runCommand("gh", ["release", "edit", version, "--repo", repo, "--title", title, "--notes-file", notesPath]);
    const uploadArgs = ["release", "upload", version, "--repo", repo, ...assets];
    if (clobber) {
      uploadArgs.push("--clobber");
    }
    runCommand("gh", uploadArgs);
    return;
  }

  runCommand("gh", [
    "release",
    "create",
    version,
    "--repo",
    repo,
    "--verify-tag",
    "--title",
    title,
    "--notes-file",
    notesPath,
    ...assets,
  ]);
}

function deleteRelease(repo, version) {
  if (releaseExists(repo, version)) {
    runCommand("gh", ["release", "delete", version, "--repo", repo, "--yes"]);
  }
}

function usage() {
  return `
Usage:
  node support/release-artifacts.cjs publish [options]

Creates or updates a GitHub release from local workflow artifacts. Dry-run by default.

Options:
  --run-id <id[,id]>       Download artifacts from one or more GitHub Actions runs first
  --version <version>      Release version; defaults to package.json version
  --title <title>          Release title; defaults to the version
  --release-dir <dir>      Asset directory; defaults to ./release
  --repo <owner/name>      GitHub repo; defaults to ${DEFAULT_REPO}
  --perform                Actually download, write checksums, and create/update release
  --clobber                Replace already-uploaded assets when the release exists
  --replace                Delete and recreate an existing release, keeping the git tag
  --allow-ci               Allow --perform inside GitHub Actions
  --help                   Show this help

Manual Windows step:
  Optional: copy the Microsoft Store wrapper to release/${WINDOWS_INSTALLER_WRAPPER} before --perform.
  If it is missing, publish continues and the website can keep linking the previous wrapper.
`.trim();
}

function parseArgs(argv) {
  const options = {
    command: "help",
    allowCi: false,
    clobber: false,
    perform: false,
    replace: false,
    releaseDir: null,
    repo: DEFAULT_REPO,
    runIds: [],
    title: null,
    version: null,
  };

  const args = [...argv];
  if (args[0] && !args[0].startsWith("-")) {
    options.command = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.command = "help";
    } else if (arg === "--perform") {
      options.perform = true;
    } else if (arg === "--clobber") {
      options.clobber = true;
    } else if (arg === "--replace") {
      options.replace = true;
    } else if (arg === "--allow-ci") {
      options.allowCi = true;
    } else if (arg === "--run-id" || arg === "--run-ids") {
      options.runIds.push(...splitRunIds(args[++index]));
    } else if (arg === "--version") {
      options.version = args[++index];
    } else if (arg === "--title") {
      options.title = args[++index];
    } else if (arg === "--release-dir") {
      options.releaseDir = args[++index];
    } else if (arg === "--repo") {
      options.repo = args[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function publish(options) {
  if (options.perform && process.env.CI === "true" && !options.allowCi) {
    throw new Error("Refusing to publish a GitHub release from CI without --allow-ci.");
  }

  const rootDir = PROJECT_ROOT;
  const version = options.version || readSourceVersion(rootDir);
  const title = options.title || version;
  const releaseDir = path.resolve(rootDir, options.releaseDir || "release");
  fs.mkdirSync(releaseDir, { recursive: true });

  // Validate the changelog before touching release state.
  releaseNotesBody(rootDir, version);

  console.log(`Publish GitHub release ${version}${options.perform ? "" : "  (dry-run; pass --perform)"}`);
  console.log(`  repo: ${options.repo}`);
  console.log(`  assets dir: ${releaseDir}`);
  if (options.runIds.length > 0) {
    console.log(`  workflow artifacts: ${options.runIds.join(", ")}`);
  }

  if (options.perform && options.runIds.length > 0) {
    for (const asset of downloadWorkflowArtifacts({ repo: options.repo, runIds: options.runIds, releaseDir })) {
      console.log(`  downloaded: ${path.basename(asset)}`);
    }
  } else if (options.runIds.length > 0) {
    console.log(`  would download workflow artifacts from run(s): ${options.runIds.join(", ")}`);
  }

  if (options.perform) {
    for (const checksum of writeChecksums(releaseDir, version)) {
      console.log(`  checksum: ${path.basename(checksum)}`);
    }
  } else {
    console.log("  would write side-by-side .sha256 files");
  }

  const wrapper = path.join(releaseDir, WINDOWS_INSTALLER_WRAPPER);
  const missing = [];
  if (!fs.existsSync(wrapper)) {
    console.log(`  windows installer wrapper: not found at ${wrapper}`);
    console.log("  windows installer wrapper: carry forward the previous published wrapper in the website data");
  }

  const assets = publicReleaseAssets(releaseDir, version);
  if (assets.length === 0) {
    missing.push(`no public release assets found in ${releaseDir}`);
  }

  const skipped = skippedReleaseAssets(releaseDir, version);
  if (skipped.length > 0) {
    console.log("  skipping non-public/helper assets:");
    for (const name of skipped) {
      console.log(`    ${name}`);
    }
  }

  console.log("  release assets:");
  for (const asset of assets) {
    console.log(`    ${path.basename(asset)}`);
  }

  const notesPath = path.join(releaseDir, `release-notes-${version}.md`);
  if (!options.perform) {
    console.log(`  would write release notes: ${notesPath}`);
    for (const item of missing) {
      console.log(`  requires: ${item}`);
    }
    console.log(`  would create/update GitHub release ${version}`);
    return { assets, missing, notesPath, version };
  }

  if (missing.length > 0) {
    throw new Error(missing.join("\n"));
  }

  const writtenNotesPath = writeReleaseNotes(rootDir, releaseDir, version);
  console.log(`  notes: ${path.basename(writtenNotesPath)}`);
  if (options.replace) {
    console.log(`  replacing release: ${version}`);
    deleteRelease(options.repo, version);
  }
  uploadRelease({ repo: options.repo, version, title, notesPath: writtenNotesPath, assets, clobber: options.clobber });
  return { assets, missing, notesPath: writtenNotesPath, version };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.command === "help") {
    console.log(usage());
    return;
  }
  if (options.command !== "publish") {
    throw new Error(`Unknown command: ${options.command}`);
  }
  publish(options);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  assetBelongsToRelease,
  extractChangelogSection,
  linuxArtifactName,
  macArtifactName,
  publicReleaseAssets,
  publish,
  skippedReleaseAssets,
  winArtifactName,
  writeChecksum,
  writeChecksums,
};
