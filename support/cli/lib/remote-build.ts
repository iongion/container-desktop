import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as dotenv from "dotenv";
import { create as tarCreate, extract as tarExtract } from "tar";
import { bundleScriptForTarget } from "@/cli/lib/bundle-target";
import { hostSystem } from "@/cli/lib/host";
import { ENVIRONMENT, PROJECT_CODE, PROJECT_HOME } from "@/cli/lib/paths";
import { type EnvOverrides, runEnv } from "@/cli/lib/process";

export const LOCAL_BUILD_BOX_KEYS: Record<string, string> = {
  win: "BUILD_WIN_BOX",
  mac: "BUILD_MAC_BOX",
  linux: "BUILD_LIN_BOX",
};
export const LOCAL_BUILD_BOX_PATH_KEYS: Record<string, string> = {
  win: "BUILD_WIN_BOX_PATH",
  mac: "BUILD_MAC_BOX_PATH",
  linux: "BUILD_LIN_BOX_PATH",
};
export const REMOTE_BUILD_ROOT = "container-desktop-remote-build/container-desktop";
export const REMOTE_SOURCE_ARCHIVE = "source.tar.gz";
export const REMOTE_ARTIFACT_ARCHIVE = "artifacts.tar.gz";

const REMOTE_EXCLUDED_DIRS = new Set([
  ".git",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  ".vscode",
  "build",
  "dist",
  "node_modules",
  "release",
  "temp",
  "website",
]);
const REMOTE_EXCLUDED_FILES = new Set([
  ".env.local",
  ".env.development.local",
  ".env.test.local",
  ".env.production.local",
]);
const REMOTE_EXCLUDED_PATTERNS = ["*.log", "*.pyc", ".DS_Store"];

export interface RemoteBundlePlan {
  platform: string;
  box: string;
  script: string;
  root: string;
}

const SHLEX_SAFE = /^[\w@%+=:,./-]+$/;
function shQuote(value: string): string {
  const text = String(value);
  if (text === "") {
    return "''";
  }
  if (SHLEX_SAFE.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

function psQuote(value: string): string {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function envSourceFiles(environment: string): Array<[string, boolean]> {
  return [
    [".env", false],
    [".env.local", true],
    [`.env.${environment}`, true],
    [`.env.${environment}.local`, true],
  ];
}

export function sourceEnvValues(
  projectRoot: string,
  environment: string,
  environ: EnvOverrides = process.env,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(environ)) {
    if (value !== undefined) {
      values[key] = value;
    }
  }
  for (const [filename, override] of envSourceFiles(environment)) {
    const filePath = path.join(projectRoot, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const parsed = dotenv.parse(fs.readFileSync(filePath));
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (override || !(key in values)) {
        values[key] = value;
      }
    }
  }
  return values;
}

export function loadLocalBuildBoxes(
  projectRoot: string,
  environ: EnvOverrides | undefined,
  environment: string,
): Record<string, string> {
  const values = sourceEnvValues(projectRoot, environment, environ);
  const boxes: Record<string, string> = {};
  for (const [platformKey, envKey] of Object.entries(LOCAL_BUILD_BOX_KEYS)) {
    boxes[platformKey] = String(values[envKey] ?? "").trim();
  }
  return boxes;
}

export function loadLocalBuildBoxPaths(
  projectRoot: string,
  environ: EnvOverrides | undefined,
  environment: string,
): Record<string, string> {
  const values = sourceEnvValues(projectRoot, environment, environ);
  const paths: Record<string, string> = {};
  for (const [platformKey, envKey] of Object.entries(LOCAL_BUILD_BOX_PATH_KEYS)) {
    paths[platformKey] = String(values[envKey] ?? "").trim();
  }
  return paths;
}

export function packagePlatformForScript(script: string | null | undefined): string | null {
  const text = String(script || "");
  if (text.includes(":win") || text.includes("windows")) {
    return "win";
  }
  if (text.includes(":mac") || text.includes("macos") || text.includes("darwin")) {
    return "mac";
  }
  if (text.includes(":linux") || text.includes("linux")) {
    return "linux";
  }
  return null;
}

export function localPlatformKey(system?: string): string | null {
  const resolved = (system || hostSystem()).toLowerCase();
  if (resolved.startsWith("win")) {
    return "win";
  }
  if (resolved === "darwin") {
    return "mac";
  }
  if (resolved === "linux") {
    return "linux";
  }
  return null;
}

function truthy(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function envValue(env: EnvOverrides | null | undefined, key: string): string | undefined {
  if (env != null && key in env) {
    return env[key];
  }
  return process.env[key];
}

function isCi(env?: EnvOverrides | null): boolean {
  return truthy(envValue(env, "CI")) || truthy(envValue(env, "GITHUB_ACTIONS"));
}

export function resolveRemoteBundle(
  script: string,
  env?: EnvOverrides | null,
  system?: string,
  projectRoot: string = PROJECT_HOME,
  environment?: string,
): RemoteBundlePlan | null {
  if (isCi(env)) {
    return null;
  }

  const targetPlatform = packagePlatformForScript(script);
  const hostPlatform = localPlatformKey(system);
  if (targetPlatform === null || targetPlatform === hostPlatform) {
    return null;
  }

  const resolvedEnvironment = environment || envValue(env, "ENVIRONMENT") || ENVIRONMENT;
  const boxes = loadLocalBuildBoxes(projectRoot, undefined, resolvedEnvironment);
  const paths = loadLocalBuildBoxPaths(projectRoot, undefined, resolvedEnvironment);
  for (const [platformKey, envKey] of Object.entries(LOCAL_BUILD_BOX_KEYS)) {
    if (env != null && envKey in env) {
      boxes[platformKey] = String(env[envKey] ?? "").trim();
    }
  }
  for (const [platformKey, envKey] of Object.entries(LOCAL_BUILD_BOX_PATH_KEYS)) {
    if (env != null && envKey in env) {
      paths[platformKey] = String(env[envKey] ?? "").trim();
    }
  }
  const box = boxes[targetPlatform] || "";
  if (!box) {
    return null;
  }

  return {
    platform: targetPlatform,
    box,
    script,
    root: paths[targetPlatform] || REMOTE_BUILD_ROOT,
  };
}

function remotePath(remoteRoot: string, filename: string): string {
  return `${remoteRoot.replace(/\/+$/, "")}/${filename}`;
}

function powershellCommand(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
}

function posixCommand(script: string): string {
  return `bash -lc ${shQuote(script)}`;
}

function remoteCommand(platformKey: string, script: string): string {
  return platformKey === "win" ? powershellCommand(script) : posixCommand(script);
}

export function windowsPrepareScript(remoteRoot: string = REMOTE_BUILD_ROOT): string {
  const root = psQuote(remoteRoot);
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$root = ${root}`,
    "New-Item -ItemType Directory -Force -Path $root | Out-Null",
    "Remove-Item -Force -ErrorAction SilentlyContinue -Path (Join-Path $root 'source.tar.gz')",
    "Remove-Item -Force -ErrorAction SilentlyContinue -Path (Join-Path $root 'artifacts.tar.gz')",
    "exit 0",
  ].join("\n");
}

export function windowsBuildScript(script: string, remoteRoot: string = REMOTE_BUILD_ROOT): string {
  const root = psQuote(remoteRoot);
  const packageScript = psQuote(script);
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "function Invoke-Yarn {",
    "  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)",
    "  if (Get-Command yarn -ErrorAction SilentlyContinue) {",
    "    & yarn @Arguments",
    "    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    "    return",
    "  }",
    "  if (Get-Command corepack -ErrorAction SilentlyContinue) {",
    "    & corepack yarn @Arguments",
    "    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    "    return",
    "  }",
    "  throw 'Remote build requires yarn or corepack on PATH'",
    "}",
    `$root = ${root}`,
    "$source = Join-Path $root 'source'",
    "$sourceArchive = Join-Path $root 'source.tar.gz'",
    "$artifactsArchive = Join-Path $root 'artifacts.tar.gz'",
    "if (Test-Path $source) { Remove-Item -Recurse -Force $source }",
    "New-Item -ItemType Directory -Force -Path $source | Out-Null",
    "tar -xzf $sourceArchive -C $source",
    "Set-Location $source",
    "Invoke-Yarn install --frozen-lockfile --production=false",
    `Invoke-Yarn ${packageScript}`,
    "if (-not (Test-Path 'release')) { throw 'Remote build did not create release directory' }",
    "tar -czf $artifactsArchive -C release .",
  ].join("\n");
}

export function posixPrepareScript(remoteRoot: string = REMOTE_BUILD_ROOT): string {
  const root = shQuote(remoteRoot);
  return [
    "set -euo pipefail",
    `root=${root}`,
    'mkdir -p "$root"',
    'rm -f "$root/source.tar.gz" "$root/artifacts.tar.gz"',
  ].join("\n");
}

export function posixBuildScript(script: string, remoteRoot: string = REMOTE_BUILD_ROOT): string {
  const root = shQuote(remoteRoot);
  const packageScript = shQuote(script);
  return [
    "set -euo pipefail",
    `root=${root}`,
    "remote_yarn() {",
    '  if command -v yarn >/dev/null 2>&1; then yarn "$@"; return; fi',
    '  if command -v corepack >/dev/null 2>&1; then corepack yarn "$@"; return; fi',
    "  echo 'Remote build requires yarn or corepack on PATH' >&2",
    "  exit 127",
    "}",
    'source_dir="$root/source"',
    'rm -rf "$source_dir"',
    'mkdir -p "$source_dir"',
    'tar -xzf "$root/source.tar.gz" -C "$source_dir"',
    'cd "$source_dir"',
    "remote_yarn install --frozen-lockfile --production=false",
    `remote_yarn ${packageScript}`,
    "test -d release",
    'tar -czf "$root/artifacts.tar.gz" -C release .',
  ].join("\n");
}

function prepareScript(platformKey: string, remoteRoot: string = REMOTE_BUILD_ROOT): string {
  return platformKey === "win" ? windowsPrepareScript(remoteRoot) : posixPrepareScript(remoteRoot);
}

function buildScript(platformKey: string, script: string, remoteRoot: string = REMOTE_BUILD_ROOT): string {
  return platformKey === "win" ? windowsBuildScript(script, remoteRoot) : posixBuildScript(script, remoteRoot);
}

function fnmatch(name: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .split("")
      .map((char) => (char === "*" ? ".*" : char === "?" ? "." : char.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
      .join("")}$`,
  );
  return regex.test(name);
}

function isRemoteExcluded(relPosix: string): boolean {
  const parts = relPosix.split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? "";
  if (parts.some((part) => REMOTE_EXCLUDED_DIRS.has(part))) {
    return true;
  }
  if (relPosix.startsWith("src-tauri/target/")) {
    return true;
  }
  // Wails build output regenerated on the remote box — keep it out of the source archive (bin/ = compiled Go
  // binaries; frontend/dist = staged renderer, also caught by the `dist` dir rule). Mirrors src-tauri/target/.
  if (relPosix.startsWith("src-wails/bin/") || relPosix.startsWith("src-wails/frontend/dist/")) {
    return true;
  }
  if (REMOTE_EXCLUDED_FILES.has(name)) {
    return true;
  }
  return REMOTE_EXCLUDED_PATTERNS.some((pattern) => fnmatch(name, pattern));
}

export function collectSourceEntries(projectRoot: string): string[] {
  const results: string[] = [];
  const walk = (dirRel: string) => {
    const abs = dirRel ? path.join(projectRoot, dirRel) : projectRoot;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (isRemoteExcluded(childRel)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(childRel);
      } else if (entry.isFile()) {
        results.push(childRel);
      }
    }
  };
  walk("");
  return results;
}

async function createRemoteSourceArchive(projectRoot: string, archivePath: string): Promise<void> {
  const entries = collectSourceEntries(projectRoot);
  await tarCreate({ gzip: true, file: archivePath, cwd: projectRoot }, entries);
}

async function extractRemoteArtifacts(archivePath: string, releaseDir: string): Promise<void> {
  fs.mkdirSync(releaseDir, { recursive: true });
  // The remote archive is built with `tar -czf ... -C release .`, so entries are flat; keep only
  // the container-desktop-* artifacts, matching _extract_remote_artifacts.
  await tarExtract({
    file: archivePath,
    cwd: releaseDir,
    filter: (entryPath: string) => path.basename(entryPath).startsWith(`${PROJECT_CODE}-`),
  });
}

function whichSync(command: string): string | null {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // keep scanning
      }
    }
  }
  return null;
}

function runProcess(args: string[]): void {
  console.log(`+ ${args.map(shQuote).join(" ")}`);
  const result = spawnSync(args[0], args.slice(1), { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${args[0]} failed (exit ${result.status ?? `signal ${result.signal}`})`);
  }
}

export async function runRemoteBundle(remotePlan: RemoteBundlePlan): Promise<void> {
  const { box, platform: platformKey, script } = remotePlan;
  const remoteRoot = remotePlan.root || REMOTE_BUILD_ROOT;
  if (whichSync("ssh") === null || whichSync("scp") === null) {
    throw new Error("Remote bundle builds require both `ssh` and `scp` on PATH.");
  }

  console.log(`Building ${script} on ${box} via ${LOCAL_BUILD_BOX_KEYS[platformKey]}`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-desktop-remote-build-"));
  try {
    const sourceArchive = path.join(tempDir, REMOTE_SOURCE_ARCHIVE);
    const artifactsArchive = path.join(tempDir, REMOTE_ARTIFACT_ARCHIVE);
    await createRemoteSourceArchive(PROJECT_HOME, sourceArchive);
    runProcess(["ssh", box, remoteCommand(platformKey, prepareScript(platformKey, remoteRoot))]);
    runProcess(["scp", sourceArchive, `${box}:${remotePath(remoteRoot, REMOTE_SOURCE_ARCHIVE)}`]);
    runProcess(["ssh", box, remoteCommand(platformKey, buildScript(platformKey, script, remoteRoot))]);
    runProcess(["scp", `${box}:${remotePath(remoteRoot, REMOTE_ARTIFACT_ARCHIVE)}`, artifactsArchive]);
    await extractRemoteArtifacts(artifactsArchive, path.join(PROJECT_HOME, "release"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export interface BundleDeps {
  resolveRemote?: (script: string, env?: EnvOverrides | null) => RemoteBundlePlan | null;
  runRemote?: (plan: RemoteBundlePlan) => Promise<void> | void;
  runLocal?: (script: string, env?: EnvOverrides) => void;
}

// Resolve the package script, then either build locally (`yarn <script>`) or dispatch to the
// configured remote box. Deps are injectable so the dispatch is unit-tested without real ssh.
export async function executeBundle(
  env: EnvOverrides = {},
  deps: BundleDeps = {},
): Promise<{ script: string; remote: boolean }> {
  const resolveRemote = deps.resolveRemote ?? resolveRemoteBundle;
  const runRemote = deps.runRemote ?? runRemoteBundle;
  const runLocal = deps.runLocal ?? ((script, overrides) => runEnv(`yarn ${script}`, overrides));

  const script = env.PACKAGE_SCRIPT || process.env.PACKAGE_SCRIPT || bundleScriptForTarget(env.TARGET);
  const remotePlan = resolveRemote(script, env);
  if (remotePlan === null) {
    runLocal(script, env);
    return { script, remote: false };
  }
  await runRemote(remotePlan);
  return { script, remote: true };
}
