import { sha256Text } from "@/ai-system/adapters/sha256";
import { parseSkillManifest } from "@/ai-system/adapters/skillManifest";
import {
  isValidSkillName,
  SKILL_LIMITS,
  SKILL_SCHEMA_VERSION,
  type SkillDescriptor,
  type SkillDiagnostic,
  type SkillManifest,
  type SkillRecord,
  type SkillSource,
  type SkillSourceSnapshot,
} from "@/ai-system/core/skills";
import type { FileSystemDirEntry, FileSystemStat, IFileDiscoverySystem, IPath } from "@/host-contract/fs";

interface DiscoverSkillSourceOptions {
  source: SkillSource;
  root: string;
  fs: IFileDiscoverySystem;
  path: IPath;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function sourceName(source: SkillSource): string {
  return source.kind;
}

export function fingerprintSkill(manifest: SkillManifest, markdown: string): Promise<string> {
  const descriptor = JSON.stringify({
    schema: SKILL_SCHEMA_VERSION,
    name: manifest.name,
    description: manifest.description,
    argumentHint: manifest.argumentHint,
    allowedTools: manifest.allowedTools,
    paths: manifest.paths,
    version: manifest.version,
  });
  return sha256Text(`${descriptor}\u0000${markdown}`);
}

function descriptorFor(source: SkillSource, manifest: SkillManifest, fingerprint: string): SkillDescriptor {
  const scope = sourceName(source);
  return {
    id: `skill:${scope}:${manifest.name}`,
    command: `/skill:${scope}:${manifest.name}`,
    shortCommand: `/skill:${manifest.name}`,
    name: manifest.name,
    description: manifest.description,
    ...(manifest.argumentHint ? { argumentHint: manifest.argumentHint } : {}),
    ...(manifest.allowedTools ? { allowedTools: manifest.allowedTools } : {}),
    ...(manifest.paths ? { paths: manifest.paths } : {}),
    ...(manifest.version ? { version: manifest.version } : {}),
    source,
    fingerprint,
  };
}

function errorSnapshot(
  options: DiscoverSkillSourceOptions,
  diagnostics: SkillDiagnostic[],
  canonicalRoot?: string,
): SkillSourceSnapshot {
  return {
    status: "error",
    source: options.source,
    root: options.root,
    ...(canonicalRoot ? { canonicalRoot } : {}),
    skills: [],
    records: [],
    diagnostics,
    totalBytes: 0,
  };
}

export async function readSkillRecord(
  options: DiscoverSkillSourceOptions,
  canonicalRoot: string,
  entry: string,
  diagnostics: SkillDiagnostic[],
): Promise<SkillRecord | undefined> {
  const directory = await options.path.join(options.root, entry);
  if (!(await options.fs.isPathWithin(canonicalRoot, directory))) {
    diagnostics.push({ code: "path-escape", entry });
    return undefined;
  }
  const directoryStat = await options.fs.lstat(directory);
  if (directoryStat.kind === "symlink") diagnostics.push({ code: "directory-symlink", entry });
  if (directoryStat.kind !== "directory") return undefined;

  const filePath = await options.path.join(directory, "SKILL.md");
  let before: FileSystemStat;
  try {
    before = await options.fs.lstat(filePath);
  } catch {
    diagnostics.push({ code: "file-missing", entry });
    return undefined;
  }
  if (before.kind === "symlink") diagnostics.push({ code: "file-symlink", entry });
  if (before.kind !== "file") {
    if (before.kind !== "symlink") diagnostics.push({ code: "file-invalid", entry });
    return undefined;
  }
  if (!(await options.fs.isPathWithin(canonicalRoot, filePath))) {
    diagnostics.push({ code: "path-escape", entry });
    return undefined;
  }
  if (before.size > SKILL_LIMITS.fileBytes) {
    diagnostics.push({ code: "file-too-large", entry });
    return undefined;
  }

  const text = await options.fs.readTextFile(filePath);
  const after = await options.fs.lstat(filePath);
  if (after.kind !== "file" || before.size !== after.size || before.modifiedMs !== after.modifiedMs) {
    diagnostics.push({ code: "file-changing", entry });
    return undefined;
  }
  const parsed = parseSkillManifest(text, entry);
  diagnostics.push(...parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, entry })));
  if (!parsed.skill) return undefined;
  const canonicalFilePath = await options.fs.realPath(filePath);
  const fingerprint = await fingerprintSkill(parsed.skill, text);
  const descriptor = descriptorFor(options.source, parsed.skill, fingerprint);
  return {
    descriptor,
    manifest: parsed.skill,
    filePath,
    canonicalFilePath,
    modifiedMs: after.modifiedMs,
    size: byteLength(text),
  };
}

export async function discoverSkillSource(options: DiscoverSkillSourceOptions): Promise<SkillSourceSnapshot> {
  const diagnostics: SkillDiagnostic[] = [];
  let rootStat: FileSystemStat;
  let canonicalRoot: string;
  try {
    rootStat = await options.fs.lstat(options.root);
    canonicalRoot = await options.fs.realPath(options.root);
  } catch {
    return errorSnapshot(options, [{ code: "source-unreadable" }]);
  }
  if (rootStat.kind !== "directory") return errorSnapshot(options, [{ code: "source-invalid" }], canonicalRoot);

  let entries: FileSystemDirEntry[];
  try {
    entries = await options.fs.listDirectory(options.root);
  } catch {
    return errorSnapshot(options, [{ code: "source-unreadable" }], canonicalRoot);
  }
  const records: SkillRecord[] = [];
  let totalBytes = 0;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.kind === "symlink") {
      diagnostics.push({ code: "directory-symlink", entry: entry.name });
      continue;
    }
    if (entry.kind !== "directory") continue;
    if (!isValidSkillName(entry.name)) {
      diagnostics.push({ code: "name-invalid", entry: entry.name });
      continue;
    }
    if (records.length >= SKILL_LIMITS.skillsPerSource) {
      diagnostics.push({ code: "count-limit" });
      break;
    }
    try {
      const record = await readSkillRecord(options, canonicalRoot, entry.name, diagnostics);
      if (!record) continue;
      if (totalBytes + record.size > SKILL_LIMITS.aggregateBytes) {
        diagnostics.push({ code: "aggregate-limit" });
        break;
      }
      totalBytes += record.size;
      records.push(record);
    } catch {
      diagnostics.push({ code: "source-unreadable", entry: entry.name });
    }
  }
  return {
    status: "ok",
    source: options.source,
    root: options.root,
    canonicalRoot,
    skills: records.map((record) => record.descriptor),
    records,
    diagnostics,
    totalBytes,
  };
}
