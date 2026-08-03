import { z } from "zod";

import {
  MAX_TOOL_ARTIFACT_BYTES,
  MAX_TOOL_ARTIFACT_FILE_BYTES,
  MAX_TOOL_ARTIFACT_TOTAL_BYTES,
  MAX_TOOL_ARTIFACTS,
  MAX_TOOL_RESULT_INLINE_BYTES,
  MAX_TOOL_RESULT_PREVIEW_CHARS,
} from "./limits";

export const TOOL_ARTIFACT_FILE_VERSION = 1 as const;

const encoder = new TextEncoder();
const byteLength = (value: string): number => encoder.encode(value).byteLength;

export const toolArtifactReferenceSchema = z
  .object({
    id: z.string().trim().min(1).max(256),
    mediaType: z.literal("application/json"),
    byteLength: z.number().int().positive().max(MAX_TOOL_ARTIFACT_BYTES),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const toolArtifactRecordSchema = toolArtifactReferenceSchema
  .extend({
    threadId: z.string().trim().min(1).max(256),
    createdAt: z.number().nonnegative(),
    content: z.string().min(1).max(MAX_TOOL_ARTIFACT_BYTES),
  })
  .strict()
  .refine((record) => byteLength(record.content) === record.byteLength, {
    message: "AI: tool artifact byte length does not match",
  })
  .refine((record) => {
    try {
      JSON.parse(record.content);
      return true;
    } catch {
      return false;
    }
  }, "AI: tool artifact content is not valid JSON");

const artifactFileSchema = z
  .object({
    version: z.literal(TOOL_ARTIFACT_FILE_VERSION),
    records: z.array(toolArtifactRecordSchema).max(MAX_TOOL_ARTIFACTS),
  })
  .strict()
  .refine((file) => new Set(file.records.map(({ id }) => id)).size === file.records.length, {
    message: "AI: duplicate tool artifact id",
  })
  .refine(
    (file) => file.records.reduce((total, record) => total + record.byteLength, 0) <= MAX_TOOL_ARTIFACT_TOTAL_BYTES,
    { message: "AI: tool artifact content exceeds its total size limit" },
  );

export type ToolArtifactReference = z.infer<typeof toolArtifactReferenceSchema>;
export type ToolArtifactRecord = z.infer<typeof toolArtifactRecordSchema>;

export interface ToolArtifactFile {
  version: typeof TOOL_ARTIFACT_FILE_VERSION;
  records: ToolArtifactRecord[];
}

export interface ToolArtifactStoreSnapshot {
  status: "missing" | "ok" | "error";
  records: ToolArtifactRecord[];
  path: string;
}

export interface ToolArtifactStore {
  load(): Promise<ToolArtifactStoreSnapshot>;
  save(records: ToolArtifactRecord[]): Promise<void>;
}

export function serializeToolArtifactPayload(value: unknown): { content: string; byteLength: number } {
  let content: string;
  try {
    content = JSON.stringify(value) ?? "null";
  } catch {
    throw new Error("AI: tool artifact payload is not serializable");
  }
  const length = byteLength(content);
  if (length > MAX_TOOL_ARTIFACT_BYTES) throw new Error("AI: tool artifact payload is too large");
  return { content, byteLength: length };
}

export interface PreparedToolResult {
  result: unknown;
  artifactPayload?: { content: string; byteLength: number };
}

export function prepareToolResultForTimeline(value: unknown): PreparedToolResult {
  let content: string;
  try {
    content = JSON.stringify(value) ?? "null";
  } catch {
    return { result: { truncated: true, originalByteLength: 0, preview: "", reason: "unserializable" } };
  }
  const length = byteLength(content);
  if (length <= MAX_TOOL_RESULT_INLINE_BYTES) return { result: JSON.parse(content) };
  const result = {
    truncated: true,
    originalByteLength: length,
    preview: content.slice(0, MAX_TOOL_RESULT_PREVIEW_CHARS),
  };
  return length <= MAX_TOOL_ARTIFACT_BYTES
    ? { result, artifactPayload: { content, byteLength: length } }
    : { result: { ...result, reason: "too-large" } };
}

export function createToolArtifactRecord(
  input: Omit<ToolArtifactRecord, "mediaType" | "byteLength"> & { byteLength?: number },
): ToolArtifactRecord {
  const candidate = {
    ...input,
    mediaType: "application/json" as const,
    byteLength: input.byteLength ?? byteLength(input.content),
  };
  const parsed = toolArtifactRecordSchema.safeParse(candidate);
  if (!parsed.success) throw new Error(`AI: invalid tool artifact (${parsed.error.issues[0].message})`);
  return parsed.data;
}

export function toolArtifactReference(record: ToolArtifactRecord): ToolArtifactReference {
  return {
    id: record.id,
    mediaType: record.mediaType,
    byteLength: record.byteLength,
    fingerprint: record.fingerprint,
  };
}

export function retainToolArtifacts(
  records: readonly ToolArtifactRecord[],
  limits: { maxRecords: number; maxTotalBytes: number } = {
    maxRecords: MAX_TOOL_ARTIFACTS,
    maxTotalBytes: MAX_TOOL_ARTIFACT_TOTAL_BYTES,
  },
): ToolArtifactRecord[] {
  const newestFirst = [...records].sort((left, right) => right.createdAt - left.createdAt);
  const retained: ToolArtifactRecord[] = [];
  let totalBytes = 0;
  for (const record of newestFirst) {
    if (retained.length >= limits.maxRecords || totalBytes + record.byteLength > limits.maxTotalBytes) continue;
    retained.push(structuredClone(record));
    totalBytes += record.byteLength;
  }
  return retained.reverse();
}

export function parseToolArtifactFile(text: string): Pick<ToolArtifactStoreSnapshot, "status" | "records"> {
  if (byteLength(text) > MAX_TOOL_ARTIFACT_FILE_BYTES) return { status: "error", records: [] };
  try {
    const parsed = artifactFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? { status: "ok", records: parsed.data.records } : { status: "error", records: [] };
  } catch {
    return { status: "error", records: [] };
  }
}

export function prepareToolArtifactFile(records: readonly ToolArtifactRecord[]): ToolArtifactFile {
  const file = {
    version: TOOL_ARTIFACT_FILE_VERSION,
    records: retainToolArtifacts(records),
  } satisfies ToolArtifactFile;
  const parsed = artifactFileSchema.safeParse(file);
  if (!parsed.success) throw new Error(`AI: invalid tool artifact file (${parsed.error.issues[0].message})`);
  if (byteLength(JSON.stringify(file)) > MAX_TOOL_ARTIFACT_FILE_BYTES) {
    throw new Error("AI: tool artifact store exceeds its size limit");
  }
  return parsed.data;
}
