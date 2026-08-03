import { z } from "zod";

import { redactText } from "./redact";

export const PROJECT_CONTEXT_LIMITS = {
  packBytes: 48 * 1024,
  sourceBytes: 16 * 1024,
  memoryEntryBytes: 8 * 1024,
  memoryEntries: 256,
  workspaces: 128,
  ruleSources: 16,
  ruleFileBytes: 64 * 1024,
  storeBytes: 4 * 1024 * 1024,
} as const;

export const PROJECT_RULE_PATHS = [
  ".container-desktop/rules.md",
  ".github/copilot-instructions.md",
  "AGENTS.md",
  "CLAUDE.md",
] as const;

export const PROJECT_RULE_INITIALIZATION_PATH = ".container-desktop/rules.md";
export const PROJECT_CONTEXT_STORE_VERSION = 1 as const;
export const PROJECT_MEMORY_EXPORT_VERSION = 1 as const;

const encoder = new TextEncoder();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedMemory = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_CONTEXT_LIMITS.memoryEntryBytes)
  .refine((value) => encoder.encode(value).byteLength <= PROJECT_CONTEXT_LIMITS.memoryEntryBytes);

export interface ProjectMemoryEntry {
  id: string;
  content: string;
  source: "user" | "import";
  createdAt: number;
  updatedAt: number;
}

export interface ProjectContextWorkspaceRecord {
  workspaceId: string;
  workspaceRoot: string;
  rulesEnabled: boolean;
  memory: ProjectMemoryEntry[];
}

export interface ProjectContextStoreSnapshot {
  status: "missing" | "ok" | "error";
  workspaces: ProjectContextWorkspaceRecord[];
  path: string;
}

export interface ProjectContextStore {
  load(): Promise<ProjectContextStoreSnapshot>;
  save(workspaces: ProjectContextWorkspaceRecord[]): Promise<void>;
}

export interface ProjectRuleSource {
  path: string;
  content: string;
  size: number;
  modifiedAt: number;
  fingerprint: string;
}

export interface ProjectContextSection {
  kind: "rules" | "memory";
  source: string;
  trust: "project" | "user";
  content: string;
  fingerprint: string;
  modifiedAt: number;
  originalBytes: number;
  includedBytes: number;
  truncated: boolean;
}

export interface ProjectContextPack {
  workspaceId: string;
  workspaceRoot: string;
  capturedAt: number;
  fingerprint: string;
  sections: ProjectContextSection[];
  budgetBytes: number;
  usedBytes: number;
  omittedSources: number;
  truncated: boolean;
  initialTaint: boolean;
}

export interface ProjectRuleDescriptor {
  path: string;
  status: "ready" | "too-large" | "unreadable";
  size?: number;
  modifiedAt?: number;
  fingerprint?: string;
  included: boolean;
}

export type ProjectContextSnapshot =
  | {
      state: "ready";
      workspaceId: string;
      workspaceRoot: string;
      rulesEnabled: boolean;
      rules: ProjectRuleDescriptor[];
      memory: ProjectMemoryEntry[];
      pack: ProjectContextPack;
    }
  | {
      state: "unconfigured" | "unavailable";
      rules: [];
      memory: [];
      message: string;
    };

export interface BuildProjectContextPackInput {
  workspaceId: string;
  workspaceRoot: string;
  capturedAt: number;
  rulesEnabled: boolean;
  rules: ProjectRuleSource[];
  memory: ProjectMemoryEntry[];
  fingerprint: (value: string) => Promise<string>;
  omittedSources?: number;
}

const projectMemoryEntrySchema = z
  .object({
    id: z.string().min(1).max(256),
    content: boundedMemory,
    source: z.enum(["user", "import"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine((entry) => entry.updatedAt >= entry.createdAt);

const projectContextWorkspaceSchema = z
  .object({
    workspaceId: hash,
    workspaceRoot: z.string().min(1).max(8_192),
    rulesEnabled: z.boolean(),
    memory: z.array(projectMemoryEntrySchema).max(PROJECT_CONTEXT_LIMITS.memoryEntries),
  })
  .strict()
  .refine((record) => new Set(record.memory.map(({ id }) => id)).size === record.memory.length);

const projectContextStoreFileSchema = z
  .object({
    version: z.literal(PROJECT_CONTEXT_STORE_VERSION),
    workspaces: z.array(projectContextWorkspaceSchema).max(PROJECT_CONTEXT_LIMITS.workspaces),
  })
  .strict()
  .refine((file) => new Set(file.workspaces.map(({ workspaceId }) => workspaceId)).size === file.workspaces.length);

const projectMemoryExportEntrySchema = z
  .object({
    content: boundedMemory,
    createdAt: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (entry) => entry.updatedAt === undefined || entry.createdAt === undefined || entry.updatedAt >= entry.createdAt,
  );

const projectMemoryExportSchema = z
  .object({
    version: z.literal(PROJECT_MEMORY_EXPORT_VERSION),
    entries: z.array(projectMemoryExportEntrySchema).max(PROJECT_CONTEXT_LIMITS.memoryEntries),
  })
  .strict();

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const total = byteLength(value);
  if (total <= maxBytes) return { text: value, bytes: total, truncated: false };
  let text = "";
  let bytes = 0;
  for (const character of value) {
    const next = byteLength(character);
    if (bytes + next > maxBytes) break;
    text += character;
    bytes += next;
  }
  return { text, bytes, truncated: true };
}

function orderedSources(input: BuildProjectContextPackInput) {
  const rules = input.rulesEnabled
    ? [...input.rules]
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, PROJECT_CONTEXT_LIMITS.ruleSources)
        .map((rule) => ({
          kind: "rules" as const,
          source: rule.path,
          trust: "project" as const,
          content: rule.content,
          fingerprint: rule.fingerprint,
          modifiedAt: rule.modifiedAt,
        }))
    : [];
  const memory = [...input.memory]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((entry) => ({
      kind: "memory" as const,
      source: `memory:${entry.id}`,
      trust: "user" as const,
      content: entry.content,
      modifiedAt: entry.updatedAt,
    }));
  return [...rules, ...memory];
}

export async function buildProjectContextPack(input: BuildProjectContextPackInput): Promise<ProjectContextPack> {
  const candidates = orderedSources(input);
  const sections: ProjectContextSection[] = [];
  let usedBytes = 0;

  for (const candidate of candidates) {
    const redacted = redactText(candidate.content);
    const originalBytes = byteLength(redacted);
    const source = truncateUtf8(redacted, PROJECT_CONTEXT_LIMITS.sourceBytes);
    const remaining = PROJECT_CONTEXT_LIMITS.packBytes - usedBytes;
    if (remaining <= 0) break;
    const retained = truncateUtf8(source.text, remaining);
    if (!retained.text) break;
    sections.push({
      kind: candidate.kind,
      source: candidate.source,
      trust: candidate.trust,
      content: retained.text,
      fingerprint: "fingerprint" in candidate ? candidate.fingerprint : await input.fingerprint(redacted),
      modifiedAt: candidate.modifiedAt,
      originalBytes,
      includedBytes: retained.bytes,
      truncated: source.truncated || retained.truncated,
    });
    usedBytes += retained.bytes;
  }

  const omittedSources = candidates.length - sections.length + (input.omittedSources ?? 0);
  const truncated = omittedSources > 0 || sections.some((section) => section.truncated);
  const fingerprint = await input.fingerprint(
    JSON.stringify(
      sections.map(({ kind, source, fingerprint: sectionFingerprint, includedBytes }) => [
        kind,
        source,
        sectionFingerprint,
        includedBytes,
      ]),
    ),
  );
  return {
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
    capturedAt: input.capturedAt,
    fingerprint,
    sections,
    budgetBytes: PROJECT_CONTEXT_LIMITS.packBytes,
    usedBytes,
    omittedSources,
    truncated,
    initialTaint: sections.length > 0,
  };
}

export function parseProjectContextStore(text: string): Omit<ProjectContextStoreSnapshot, "path"> {
  if (byteLength(text) > PROJECT_CONTEXT_LIMITS.storeBytes) return { status: "error", workspaces: [] };
  try {
    const result = projectContextStoreFileSchema.safeParse(JSON.parse(text));
    return result.success ? { status: "ok", workspaces: result.data.workspaces } : { status: "error", workspaces: [] };
  } catch {
    return { status: "error", workspaces: [] };
  }
}

export function prepareProjectContextStore(workspaces: ProjectContextWorkspaceRecord[]) {
  const file = {
    version: PROJECT_CONTEXT_STORE_VERSION,
    workspaces: [...workspaces]
      .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))
      .slice(0, PROJECT_CONTEXT_LIMITS.workspaces),
  };
  const result = projectContextStoreFileSchema.safeParse(file);
  if (!result.success || byteLength(JSON.stringify(file)) > PROJECT_CONTEXT_LIMITS.storeBytes) {
    throw new Error("AI: invalid or oversized project context record");
  }
  return result.data;
}

export function prepareProjectMemoryExport(memory: ProjectMemoryEntry[]) {
  return projectMemoryExportSchema.parse({
    version: PROJECT_MEMORY_EXPORT_VERSION,
    entries: memory.map(({ content, createdAt, updatedAt }) => ({ content, createdAt, updatedAt })),
  });
}

export function parseProjectMemoryImport(text: string): Array<{
  content: string;
  createdAt?: number;
  updatedAt?: number;
}> {
  if (byteLength(text) > PROJECT_CONTEXT_LIMITS.storeBytes) throw new Error("AI: project memory import is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI: project memory import is invalid");
  }
  const result = projectMemoryExportSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI: project memory import is invalid");
  return result.data.entries.map(({ content, createdAt, updatedAt }) => ({
    content: redactText(content),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }));
}
