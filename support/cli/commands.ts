import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { auditShared } from "@/cli/lib/audit-shared";
import { fetchAppx } from "@/cli/lib/fetch-appx";
import { commitRelease } from "@/cli/lib/git";
import { createIcons } from "@/cli/lib/icons";
import { PROJECT_HOME, projectVersion, readSourceVersion } from "@/cli/lib/paths";
import { type EnvOverrides, runEnv } from "@/cli/lib/process";
import { runBump, runVersionSync } from "@/cli/lib/release";
import { publishMeta } from "@/cli/lib/release-meta";
import { executeBundle } from "@/cli/lib/remote-build";
import { installSelfSignedAppx, uninstallSelfSignedAppx } from "@/cli/lib/self-signed-appx";

// Thin action layer: one function per invoke task. The heavy logic lives in lib/*; these wire the
// commander options to it and keep index.ts pure wiring.

const require = createRequire(import.meta.url);
const releaseArtifacts = require("../release-artifacts.cjs");

export function runClean(): void {
  for (const dir of ["node_modules", "bin", "build", "release"]) {
    fs.rmSync(path.join(PROJECT_HOME, dir), { recursive: true, force: true });
  }
}

export function runPrepare(): void {
  runEnv("yarn install --frozen-lockfile --production=false");
}

export function runBuild(env?: EnvOverrides): void {
  fs.rmSync(path.join(PROJECT_HOME, "build"), { recursive: true, force: true });
  runEnv("yarn build", env);
  // Icons are loaded from __dirname at runtime, so co-locate them with the versioned build output.
  const buildDir = path.join(PROJECT_HOME, "build", projectVersion());
  const iconsDir = path.join(PROJECT_HOME, "src/resources/icons");
  for (const file of fs.readdirSync(iconsDir)) {
    if (file.startsWith("appIcon") || file.startsWith("trayIcon")) {
      fs.copyFileSync(path.join(iconsDir, file), path.join(buildDir, file));
    }
  }
}

export async function runBundle(env?: EnvOverrides): Promise<void> {
  await executeBundle(env ?? {});
}

export async function runRelease(): Promise<void> {
  await runBundle({ NODE_ENV: "production", ENVIRONMENT: "production" });
  runChecksums();
}

export function runChecksums(): void {
  const releaseDir = path.join(PROJECT_HOME, "release");
  if (!fs.existsSync(releaseDir)) {
    return;
  }
  for (const name of fs.readdirSync(releaseDir)) {
    if (!name.startsWith("container-desktop-") || name.endsWith(".sha256")) {
      continue;
    }
    const installerPath = path.join(releaseDir, name);
    if (!fs.statSync(installerPath).isFile()) {
      continue;
    }
    console.log(`Creating checksum for ${installerPath}`);
    const checksum = crypto.createHash("sha256").update(fs.readFileSync(installerPath)).digest("hex");
    fs.writeFileSync(`${installerPath}.sha256`, checksum, "utf8");
  }
}

export function runStart(): void {
  runEnv("yarn dev");
}

export function runBuildWebsite(): void {
  fs.rmSync(path.join(PROJECT_HOME, "website"), { recursive: true, force: true });
  runEnv("yarn build:website");
}

// Translate commander options into the argv the media capture scripts parse. `--backend` (or the
// CONTAINER_DESKTOP_CAPTURE_BACKEND env var read inside the scripts) picks electron vs tauri.
function mediaArgs(options: {
  mode?: string;
  backend?: string;
  engine?: string;
  only?: string;
  clean?: boolean;
  killStray?: boolean;
}): string[] {
  const args = [`--mode=${options.mode ?? "dev"}`];
  if (options.backend) {
    args.push(`--backend=${options.backend}`);
  }
  if (options.engine) {
    args.push(`--engine=${options.engine}`);
  }
  if (options.only) {
    args.push(`--only=${options.only}`);
  }
  if (options.clean) {
    args.push("--clean");
  }
  if (options.killStray) {
    args.push("--kill-stray");
  }
  return args;
}

export async function runUpdateScreenshots(options: Parameters<typeof mediaArgs>[0] = {}): Promise<void> {
  const { main } = await import("@/cli/media/screenshots");
  await main(mediaArgs(options));
}

export async function runUpdateDemoReplay(options: Parameters<typeof mediaArgs>[0] = {}): Promise<void> {
  const { main } = await import("@/cli/media/demoReplay");
  await main(mediaArgs(options));
}

export async function runGenerateEngineIcons(): Promise<void> {
  const { main } = await import("@/cli/media/generate-engine-icons");
  await main();
}

export function runAuditShared(): void {
  if (auditShared() > 0) {
    throw new Error("audit-shared: shared-code leaks detected");
  }
}

export function runCommitRelease(): void {
  const version = readSourceVersion();
  console.log(`Commit release ${version} (all working-tree changes: version files + website/ + assets)`);
  commitRelease(version);
}

export function runPublishRelease(options: {
  version?: string;
  runId?: string;
  title?: string;
  perform?: boolean;
  clobber?: boolean;
  replace?: boolean;
}): void {
  const runIds = options.runId ? String(options.runId).replaceAll(",", " ").split(/\s+/).filter(Boolean) : [];
  releaseArtifacts.publish({
    command: "publish",
    allowCi: false,
    clobber: Boolean(options.clobber),
    perform: Boolean(options.perform),
    replace: Boolean(options.replace),
    releaseDir: null,
    repo: "iongion/container-desktop",
    runIds,
    title: options.title ?? null,
    version: options.version ?? null,
  });
}

export { createIcons, fetchAppx, installSelfSignedAppx, publishMeta, runBump, runVersionSync, uninstallSelfSignedAppx };
