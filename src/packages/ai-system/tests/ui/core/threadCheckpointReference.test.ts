import { describe, expect, it } from "vitest";
import type { ThreadCheckpoint } from "@/ai-system/core/threads";
import { resolveThreadCheckpointReference } from "@/ai-system/ui/core/threadCheckpointReference";

const checkpoints: ThreadCheckpoint[] = [
  { id: "checkpoint-alpha", messageId: "message-alpha", createdAt: 1, timelineLength: 1, modelHistoryLength: 1 },
  { id: "checkpoint-beta", messageId: "message-beta", createdAt: 2, timelineLength: 2, modelHistoryLength: 2 },
  { id: "checkpoint-better", messageId: "message-better", createdAt: 3, timelineLength: 3, modelHistoryLength: 3 },
];

describe("resolveThreadCheckpointReference", () => {
  it("uses the latest checkpoint when no reference is supplied", () => {
    expect(resolveThreadCheckpointReference(checkpoints, "")).toEqual(checkpoints[2]);
  });

  it("accepts exact ids, message ids, and unique prefixes", () => {
    expect(resolveThreadCheckpointReference(checkpoints, "checkpoint-alpha")).toEqual(checkpoints[0]);
    expect(resolveThreadCheckpointReference(checkpoints, "message-beta")).toEqual(checkpoints[1]);
    expect(resolveThreadCheckpointReference(checkpoints, "checkpoint-bett")).toEqual(checkpoints[2]);
  });

  it("rejects ambiguous and unknown references", () => {
    expect(resolveThreadCheckpointReference(checkpoints, "checkpoint-b")).toBeUndefined();
    expect(resolveThreadCheckpointReference(checkpoints, "unknown")).toBeUndefined();
  });
});
