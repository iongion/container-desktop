import { parseDocument } from "yaml";

import {
  isValidSkillName,
  SKILL_LIMITS,
  type SkillDiagnostic,
  type SkillManifest,
  type SkillManifestParseResult,
} from "@/ai-system/core/skills";
import { isWorkerToolName } from "@/ai-system/core/workerTools";

const SUPPORTED_FIELDS = new Set(["name", "description", "argument-hint", "allowed-tools", "paths", "version"]);
const FRONTMATTER = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasUnsafeText(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return (
      point <= 0x1f ||
      (point >= 0x7f && point <= 0x9f) ||
      (point >= 0x202a && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069)
    );
  });
}

function scalar(
  value: unknown,
  field: string,
  required: boolean,
  maxBytes: number,
  diagnostics: SkillDiagnostic[],
): string | undefined {
  if (value === undefined || value === null) {
    if (required) diagnostics.push({ code: "field-missing", field });
    return undefined;
  }
  if (typeof value !== "string" && (field !== "version" || typeof value !== "number")) {
    diagnostics.push({ code: "field-invalid", field });
    return undefined;
  }
  const text = String(value).trim();
  if (!text || byteLength(text) > maxBytes) diagnostics.push({ code: "field-invalid", field });
  else if (hasUnsafeText(text)) diagnostics.push({ code: "text-unsafe", field });
  else return text;
  return undefined;
}

function stringList(value: unknown, field: string, max: number, diagnostics: SkillDiagnostic[]): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(field === "allowed-tools" ? /[\s,]+/u : /,/u)
      : null;
  if (!entries || entries.some((entry) => typeof entry !== "string")) {
    diagnostics.push({ code: "field-invalid", field });
    return undefined;
  }
  const values = [...new Set(entries.map((entry) => String(entry).trim()).filter(Boolean))];
  if (values.length > max) diagnostics.push({ code: "list-too-large", field });
  if (values.some(hasUnsafeText)) diagnostics.push({ code: "text-unsafe", field });
  return values;
}

function validPathHint(path: string): boolean {
  if (!path || byteLength(path) > SKILL_LIMITS.pathBytes || path.startsWith("/") || path.includes("\\")) return false;
  return !path.split("/").some((segment) => segment === "..");
}

function parseYaml(text: string, diagnostics: SkillDiagnostic[]): Record<string, unknown> | undefined {
  try {
    const document = parseDocument(text, { schema: "core", uniqueKeys: true });
    if (document.errors.length > 0) throw document.errors[0];
    const value: unknown = document.toJS({ maxAliasCount: 0 });
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a mapping");
    return value as Record<string, unknown>;
  } catch {
    diagnostics.push({ code: "frontmatter-invalid" });
    return undefined;
  }
}

function validateLists(
  raw: Record<string, unknown>,
  diagnostics: SkillDiagnostic[],
): Pick<SkillManifest, "allowedTools" | "paths"> {
  const allowedTools = stringList(raw["allowed-tools"], "allowed-tools", SKILL_LIMITS.toolCount, diagnostics);
  for (const tool of allowedTools ?? []) {
    if (!isWorkerToolName(tool)) diagnostics.push({ code: "tool-unknown", field: "allowed-tools" });
  }
  const paths = stringList(raw.paths, "paths", SKILL_LIMITS.pathCount, diagnostics);
  for (const path of paths ?? []) {
    if (!validPathHint(path)) diagnostics.push({ code: "path-invalid", field: "paths" });
  }
  return { allowedTools, paths };
}

export function parseSkillManifest(text: string, directoryName: string): SkillManifestParseResult {
  const diagnostics: SkillDiagnostic[] = [];
  if (byteLength(text) > SKILL_LIMITS.fileBytes) return { diagnostics: [{ code: "file-too-large" }] };
  if (text.includes("\uFFFD")) return { diagnostics: [{ code: "encoding-invalid" }] };
  const match = FRONTMATTER.exec(text);
  if (!match) return { diagnostics: [{ code: "frontmatter-missing" }] };
  const frontmatter = match[1] ?? "";
  if (byteLength(frontmatter) > SKILL_LIMITS.frontmatterBytes) {
    return { diagnostics: [{ code: "frontmatter-too-large" }] };
  }
  const raw = parseYaml(frontmatter, diagnostics);
  if (!raw) return { diagnostics };
  for (const field of Object.keys(raw)) {
    if (!SUPPORTED_FIELDS.has(field)) diagnostics.push({ code: "field-unsupported", field });
  }

  const name = scalar(raw.name, "name", true, SKILL_LIMITS.nameBytes, diagnostics);
  const description = scalar(raw.description, "description", true, SKILL_LIMITS.descriptionBytes, diagnostics);
  const argumentHint = scalar(
    raw["argument-hint"],
    "argument-hint",
    false,
    SKILL_LIMITS.argumentHintBytes,
    diagnostics,
  );
  const version = scalar(raw.version, "version", false, SKILL_LIMITS.versionBytes, diagnostics);
  if (name && !isValidSkillName(name)) diagnostics.push({ code: "name-invalid", field: "name" });
  if (name && name !== directoryName) diagnostics.push({ code: "name-mismatch", field: "name" });
  const { allowedTools, paths } = validateLists(raw, diagnostics);
  const body = text.slice(match[0].length);
  if (!body.trim()) diagnostics.push({ code: "body-empty" });
  if (byteLength(body) > SKILL_LIMITS.bodyBytes) diagnostics.push({ code: "body-too-large" });
  if (diagnostics.length > 0 || !name || !description) return { diagnostics };

  return {
    diagnostics,
    skill: {
      name,
      description,
      ...(argumentHint ? { argumentHint } : {}),
      ...(allowedTools ? { allowedTools } : {}),
      ...(paths ? { paths } : {}),
      ...(version ? { version } : {}),
      body,
    },
  };
}
