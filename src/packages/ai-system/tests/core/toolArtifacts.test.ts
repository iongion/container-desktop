import { describe, expect, it } from "vitest";

import {
  createToolArtifactRecord,
  parseToolArtifactFile,
  prepareToolArtifactFile,
  prepareToolResultForTimeline,
  retainToolArtifacts,
  serializeToolArtifactPayload,
  toolArtifactReference,
} from "@/ai-system/core/toolArtifacts";

const fingerprint = "a".repeat(64);

function artifact(id: string, createdAt: number, content = JSON.stringify({ id })) {
  return createToolArtifactRecord({ id, threadId: "thread-1", createdAt, content, fingerprint });
}

describe("tool artifacts", () => {
  it("keeps small results inline and prepares a bounded preview plus private payload for large results", () => {
    expect(prepareToolResultForTimeline({ state: "healthy" })).toEqual({ result: { state: "healthy" } });

    const prepared = prepareToolResultForTimeline({ output: "x".repeat(40 * 1024) });

    expect(prepared.result).toMatchObject({ truncated: true, originalByteLength: expect.any(Number) });
    expect(JSON.stringify(prepared.result).length).toBeLessThan(10_000);
    expect(prepared.artifactPayload?.byteLength).toBeGreaterThan(32 * 1024);
    expect(prepared.artifactPayload?.content).toContain('"output"');
  });

  it("serializes JSON using UTF-8 byte counts and exposes only an opaque reference", () => {
    const payload = serializeToolArtifactPayload({ text: "héllo" });
    const record = createToolArtifactRecord({
      id: "artifact-1",
      threadId: "thread-1",
      createdAt: 2,
      fingerprint,
      ...payload,
    });

    expect(record.byteLength).toBe(new TextEncoder().encode(record.content).byteLength);
    expect(toolArtifactReference(record)).toEqual({
      id: "artifact-1",
      mediaType: "application/json",
      byteLength: record.byteLength,
      fingerprint,
    });
    expect(toolArtifactReference(record)).not.toHaveProperty("content");
    expect(toolArtifactReference(record)).not.toHaveProperty("path");
    expect(toolArtifactReference(record)).not.toHaveProperty("threadId");
  });

  it("rejects circular and oversized payloads before persistence", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => serializeToolArtifactPayload(circular)).toThrow(/serializable/i);
    expect(() => serializeToolArtifactPayload("x".repeat(4 * 1024 * 1024))).toThrow(/too large/i);
  });

  it("retains newest artifacts within count and total-byte budgets", () => {
    const records = [artifact("one", 1, '"111"'), artifact("two", 2, '"22"'), artifact("three", 3, '"3"')];

    expect(retainToolArtifacts(records, { maxRecords: 2, maxTotalBytes: 7 }).map(({ id }) => id)).toEqual([
      "two",
      "three",
    ]);
    expect(retainToolArtifacts(records, { maxRecords: 3, maxTotalBytes: 4 }).map(({ id }) => id)).toEqual(["three"]);
  });

  it("round-trips a bounded file and fails closed on corrupt metadata", () => {
    const file = prepareToolArtifactFile([artifact("artifact-1", 1)]);

    expect(parseToolArtifactFile(JSON.stringify(file))).toEqual({ status: "ok", records: file.records });
    expect(parseToolArtifactFile("{bad json")).toEqual({ status: "error", records: [] });
    expect(
      parseToolArtifactFile(
        JSON.stringify({
          ...file,
          records: [{ ...file.records[0], byteLength: file.records[0].byteLength + 1 }],
        }),
      ),
    ).toEqual({ status: "error", records: [] });
  });
});
