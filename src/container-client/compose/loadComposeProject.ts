// Load + fully resolve a compose project into a ComposeProjectModel. This is the ONLY compose module
// that does I/O — via the ambient FS/Path host ports (renderer-safe on both shells). It reads the file
// (or takes raw text from the AI generator), applies `.env` interpolation, validates, pre-reads every
// referenced env_file, then hands everything to the pure normalizer.

import { parseEnvFile } from "./envfile";
import { interpolateTree } from "./interpolate";
import { normalizeProject } from "./normalize";
import { parseComposeYaml } from "./parse";
import type { ComposeProjectModel } from "./types";
import { validateComposeSpec } from "./validate";

export type ComposeInput = ({ path: string } | { text: string; dir?: string }) & { projectName?: string };

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function sanitizeName(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "compose";
}

async function readIfPresent(path: string): Promise<string | undefined> {
  return (await FS.isFilePresent(path)) ? FS.readTextFile(path) : undefined;
}

// Read, interpolate, validate and normalize a compose project.
export async function loadComposeProject(input: ComposeInput): Promise<ComposeProjectModel> {
  let text: string;
  let projectDir: string;
  let hasDir: boolean;
  if ("path" in input) {
    text = await FS.readTextFile(input.path);
    projectDir = await Path.dirname(input.path);
    hasDir = true;
  } else {
    text = input.text;
    projectDir = input.dir ?? ".";
    hasDir = input.dir != null;
  }

  // Project `.env` is the interpolation source (never the host shell — see plan).
  let dotenv: Record<string, string> = {};
  if (hasDir) {
    const dotenvText = await readIfPresent(await Path.resolve(projectDir, ".env"));
    if (dotenvText != null) dotenv = parseEnvFile(dotenvText);
  }

  const rawDoc = parseComposeYaml(text);
  const interpolated = interpolateTree(rawDoc, dotenv);
  validateComposeSpec(interpolated);

  // Pre-read every referenced env_file (the normalizer is sync; FS is async).
  const envFiles = new Map<string, Record<string, string>>();
  if (hasDir) {
    for (const service of Object.values(asRecord(asRecord(interpolated).services))) {
      for (const ref of asArray(asRecord(service).env_file)) {
        const isObj = typeof ref === "object" && ref !== null;
        const p = isObj ? String((ref as Record<string, unknown>).path) : String(ref);
        // env_file entries are required unless `required: false` — a missing required file is an error,
        // not a silent {} (Compose fails the load).
        const required = isObj ? (ref as Record<string, unknown>).required !== false : true;
        if (envFiles.has(p)) continue;
        const content = await readIfPresent(await Path.resolve(projectDir, p));
        if (content == null && required) {
          throw new Error(`env_file not found (required): ${p}`);
        }
        envFiles.set(p, content != null ? parseEnvFile(content) : {});
      }
    }
  }

  const model = normalizeProject(interpolated, {
    name: sanitizeName(await Path.basename(projectDir)),
    projectDir,
    resolveEnvFile: (p) => envFiles.get(p) ?? {},
  });
  model.name = sanitizeName(input.projectName ?? model.name);
  return model;
}
