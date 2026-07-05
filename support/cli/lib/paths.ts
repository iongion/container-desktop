import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Project constants + basic file IO for the release commands. PROJECT_HOME is the repo root
// (this file lives at support/cli/lib/), mirroring tasks.py's PROJECT_HOME.

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_HOME = path.resolve(here, "..", "..", "..");
export const PROJECT_CODE = "container-desktop";
export const REPO_SLUG = "iongion/container-desktop";
export const NODE_ENV = process.env.NODE_ENV || "development";
export const ENVIRONMENT = process.env.ENVIRONMENT || NODE_ENV;
export const TARGET = process.env.TARGET || "linux";
export const PORT = Number(process.env.PORT || 3000);

export function readText(rel: string): string {
  return fs.readFileSync(path.join(PROJECT_HOME, rel), "utf8");
}

export function writeText(rel: string, content: string): void {
  fs.writeFileSync(path.join(PROJECT_HOME, rel), content, "utf8");
}

/** The version baked into the VERSION file (what get_env exposes as PROJECT_VERSION). */
export function projectVersion(): string {
  return readText("VERSION").trim();
}

/** The single source of truth: package.json `version`. */
export function readSourceVersion(): string {
  return JSON.parse(readText("package.json")).version;
}
