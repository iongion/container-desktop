import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type GhArtifact,
  parseWindowsStorePackageVersion,
  selectWindowsArtifact,
  windowsArtifactName,
} from "@/cli/lib/ci-artifacts";
import { PROJECT_HOME, projectVersion, REPO_SLUG } from "@/cli/lib/paths";
import { capture, run, shellQuote } from "@/cli/lib/process";

// Download the Microsoft Store package (AppX/MSIX) from a CDPipeline run without a local build. The
// Windows CD job keeps it OFF the public GitHub release, so it only lives inside that run's per-arch
// Windows upload artifact. Fetches it with `gh`, verifies the checksum and drops it in release/.

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

export function fetchAppx(options: { runId?: string; version?: string; arch?: string; keep?: boolean } = {}): void {
  const arch = options.arch || "x64";
  const dir = releaseDir();
  const artifactName = windowsArtifactName(arch);

  let runId = options.runId;
  if (!runId) {
    const artifact = selectWindowsArtifact(repoArtifacts(), artifactName);
    if (artifact === null) {
      throw new Error(
        `No downloadable '${artifactName}' artifact found ` +
          "(none built yet, or all expired -- re-run CDPipeline for the windows target).",
      );
    }
    runId = String(artifact.workflow_run?.id);
    console.log(`Using newest '${artifactName}' artifact from run ${runId}`);
  } else {
    console.log(`Using '${artifactName}' artifact from run ${runId} (--run-id)`);
  }

  const downloadDir = path.join(dir, `_store-package-${runId}`);
  fs.rmSync(downloadDir, { recursive: true, force: true });
  let target = "";
  try {
    run(
      `gh run download ${shellQuote(runId)} --repo ${shellQuote(REPO_SLUG)} ` +
        `-n ${shellQuote(artifactName)} --dir ${shellQuote(downloadDir)}`,
    );
    const storePackages = [
      ...walkFiles(downloadDir)
        .filter((file) => file.endsWith(".appx"))
        .sort(),
      ...walkFiles(downloadDir)
        .filter((file) => file.endsWith(".msix"))
        .sort(),
    ];
    if (storePackages.length === 0) {
      throw new Error(`No .appx/.msix inside '${artifactName}' (run ${runId}).`);
    }
    const storePackage = storePackages[0];
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

    target = path.join(dir, path.basename(storePackage));
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
    }
  } finally {
    if (options.keep) {
      console.log(`  kept raw download: ${downloadDir}`);
    } else {
      fs.rmSync(downloadDir, { recursive: true, force: true });
    }
  }

  console.log("");
  console.log(`Ready: ${target}`);
  console.log("Next: Partner Center -> your app -> Packages -> upload this Store package -> Submit.");
  console.log("The Store re-signs it (no certificate needed); the version must exceed the last submission.");
}
