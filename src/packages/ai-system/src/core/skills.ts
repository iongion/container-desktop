export const SKILL_SCHEMA_VERSION = 1 as const;

export const SKILL_LIMITS = {
  nameBytes: 64,
  descriptionBytes: 512,
  argumentHintBytes: 160,
  versionBytes: 64,
  pathBytes: 512,
  toolCount: 64,
  pathCount: 64,
  frontmatterBytes: 16 * 1024,
  bodyBytes: 128 * 1024,
  fileBytes: 160 * 1024,
  argumentBytes: 8 * 1024,
  renderedPromptBytes: 160 * 1024,
  skillsPerSource: 256,
  aggregateBytes: 4 * 1024 * 1024,
} as const;

export type SkillSourceKind = "bundled" | "user" | "project";

export type SkillSource = { kind: "bundled" } | { kind: "user" } | { kind: "project"; workspaceId: string };

export interface SkillManifest {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  paths?: string[];
  version?: string;
  body: string;
}

export const SKILL_DIAGNOSTIC_CODES = [
  "file-too-large",
  "frontmatter-missing",
  "frontmatter-too-large",
  "frontmatter-invalid",
  "field-missing",
  "field-invalid",
  "field-unsupported",
  "name-invalid",
  "name-mismatch",
  "text-unsafe",
  "encoding-invalid",
  "list-too-large",
  "tool-unknown",
  "path-invalid",
  "body-empty",
  "body-too-large",
  "source-unreadable",
  "source-invalid",
  "directory-symlink",
  "file-missing",
  "file-symlink",
  "file-invalid",
  "path-escape",
  "file-changing",
  "count-limit",
  "aggregate-limit",
] as const;

export type SkillDiagnosticCode = (typeof SKILL_DIAGNOSTIC_CODES)[number];

export interface SkillDiagnostic {
  code: SkillDiagnosticCode;
  field?: string;
  entry?: string;
}

export interface SkillManifestParseResult {
  skill?: SkillManifest;
  diagnostics: SkillDiagnostic[];
}

export interface SkillDescriptor {
  id: string;
  command: string;
  shortCommand?: string;
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  paths?: string[];
  version?: string;
  source: SkillSource;
  fingerprint: string;
}

export interface SkillViewDescriptor extends SkillDescriptor {
  enabled: boolean;
  trusted: boolean;
}

export interface SkillProjectSourceView {
  workspaceId: string;
  root: string;
  enabled: boolean;
  status: "ok" | "error";
}

export interface SkillHostSnapshot {
  revision: string;
  user: { root: string; status: "ok" | "error" };
  skills: SkillViewDescriptor[];
  diagnostics: SkillDiagnostic[];
  project?: SkillProjectSourceView;
}

export interface ResolveSkillInvocationRequest {
  skillId: string;
  expectedFingerprint: string;
  arguments: string;
}

export interface ResolvedSkillInvocation {
  descriptor: SkillDescriptor;
  manifest: SkillManifest;
  arguments: string;
  initialTaint: boolean;
}

export interface SkillInvocationProvenance {
  skillId: string;
  command: string;
  source: SkillSourceKind;
  fingerprint: string;
}

export interface SkillRecord {
  descriptor: SkillDescriptor;
  manifest: SkillManifest;
  filePath: string;
  canonicalFilePath: string;
  modifiedMs: number;
  size: number;
}

export interface SkillSourceSnapshot {
  status: "ok" | "error";
  source: SkillSource;
  root: string;
  canonicalRoot?: string;
  skills: SkillDescriptor[];
  records: SkillRecord[];
  diagnostics: SkillDiagnostic[];
  totalBytes: number;
}

export function isValidSkillName(name: string): boolean {
  return name.length <= SKILL_LIMITS.nameBytes && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

export function narrowSkillTools(available: ReadonlySet<string>, allowed?: readonly string[]): ReadonlySet<string> {
  if (!allowed) return available;
  return new Set(allowed.filter((tool) => available.has(tool)));
}
