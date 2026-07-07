import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type GhArtifact,
  parseWindowsStorePackageVersion,
  pickStorePackage,
  resolveStoreArches,
  type StorePackageFormat,
  selectWindowsArtifact,
  windowsArtifactName,
} from "@/cli/lib/ci-artifacts";
import { PROJECT_HOME, projectVersion, REPO_SLUG } from "@/cli/lib/paths";
import { capture, run, shellQuote } from "@/cli/lib/process";

// Download the Microsoft Store packages (AppX/MSIX) from a CDPipeline.Tauri run without a local build. The
// Windows CD job keeps them OFF the public GitHub release, so they only live inside each run's per-arch
// Windows upload artifact. Fetches with `gh`, verifies the sidecar checksum and drops them in release/.
// fetchAppx/fetchMsix pull BOTH arches by default — a multi-arch Store submission needs x64 + arm64.

interface FetchOptions {
  runId?: string;
  version?: string;
  arch?: string;
  keep?: boolean;
}

function releaseDir(): string {
  const dir = path.join(PROJECT_HOME, "release");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function repoArtifacts(): GhArtifact[] {
  const result = capture(`gh api ${shellQuote(`repos/${REPO_SLUG}/actions/artifacts?per_page=100`)}`, {
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new Error("Could not list GitHub artifacts -- is `gh` installed and authenticated? Try `gh auth login`.");
  }
  return JSON.parse(result.stdout || "{}").artifacts || [];
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
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

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// Download one arch's Windows CI artifact, extract the requested Store package format, verify its
// checksum and copy it (plus the .sha256 sidecar) into release/. Returns the copied package path.
function fetchStorePackage(format: StorePackageFormat, arch: string, dir: string, options: FetchOptions): string {
  const artifactName = windowsArtifactName(arch);

  let runId = options.runId;
  if (!runId) {
    const artifact = selectWindowsArtifact(repoArtifacts(), artifactName);
    if (artifact === null) {
      throw new Error(
        `No downloadable '${artifactName}' artifact found ` +
          "(none built yet, or all expired -- re-run CDPipeline.Tauri for the windows target).",
      );
    }
    runId = String(artifact.workflow_run?.id);
    console.log(`Using newest '${artifactName}' artifact from run ${runId}`);
  } else {
    console.log(`Using '${artifactName}' artifact from run ${runId} (--run-id)`);
  }

  const downloadDir = path.join(dir, `_store-package-${arch}-${runId}`);
  fs.rmSync(downloadDir, { recursive: true, force: true });
  try {
    run(
      `gh run download ${shellQuote(runId)} --repo ${shellQuote(REPO_SLUG)} ` +
        `-n ${shellQuote(artifactName)} --dir ${shellQuote(downloadDir)}`,
    );
    const storePackage = pickStorePackage(walkFiles(downloadDir), format);
    if (storePackage === null) {
      throw new Error(`No .${format} inside '${artifactName}' (run ${runId}).`);
    }
    const foundVersion = parseWindowsStorePackageVersion(path.basename(storePackage));
    if (options.version && foundVersion !== options.version) {
      throw new Error(
        `Fetched ${path.basename(storePackage)} (version ${foundVersion}) != requested --version ${options.version}. ` +
          "Pass the matching --run-id, or drop --version to accept this build.",
      );
    }
    if (foundVersion !== projectVersion()) {
      console.log(`  note: fetched version ${foundVersion} differs from local VERSION (${projectVersion()})`);
    }

    const target = path.join(dir, path.basename(storePackage));
    fs.copyFileSync(storePackage, target);
    console.log(`  extracted: ${path.basename(target)}`);

    const checksumSrc = `${storePackage}.sha256`;
    if (fs.existsSync(checksumSrc)) {
      fs.copyFileSync(checksumSrc, path.join(dir, path.basename(checksumSrc)));
      const expected = fs.readFileSync(checksumSrc, "utf8").trim().split(/\s+/)[0];
      const actual = sha256File(target);
      if (actual !== expected) {
        throw new Error(`Checksum mismatch for ${path.basename(target)}: expected ${expected}, got ${actual}`);
      }
      console.log(`  checksum OK (${actual.slice(0, 12)}...)`);
    } else {
      console.log(`  note: no ${path.basename(checksumSrc)} sidecar in the artifact -- skipping checksum verify`);
    }
    return target;
  } finally {
    if (options.keep) {
      console.log(`  kept raw download: ${downloadDir}`);
    } else {
      fs.rmSync(downloadDir, { recursive: true, force: true });
    }
  }
}

// Fetch a Store package format for every requested arch (both x64 + arm64 unless --arch narrows it).
function fetchWindowsStorePackages(format: StorePackageFormat, options: FetchOptions): string[] {
  const dir = releaseDir();
  const targets = resolveStoreArches(options.arch).map((arch) => fetchStorePackage(format, arch, dir, options));

  console.log("");
  console.log(`Ready (${format.toUpperCase()}): ${targets.map((target) => path.basename(target)).join(", ")}`);
  console.log("Next: Partner Center -> your app -> Packages -> upload these Store packages -> Submit.");
  console.log("The Store re-signs them (no certificate needed); the version must exceed the last submission.");
  return targets;
}

export function fetchAppx(options: FetchOptions = {}): void {
  fetchWindowsStorePackages("appx", options);
}

export function fetchMsix(options: FetchOptions = {}): void {
  fetchWindowsStorePackages("msix", options);
}
