import type { ThreadCheckpoint } from "@/ai-system/core/threads";

export function resolveThreadCheckpointReference(
  checkpoints: readonly ThreadCheckpoint[],
  reference: string,
): ThreadCheckpoint | undefined {
  const query = reference.trim();
  if (!query) return checkpoints.at(-1);
  const exact = checkpoints.find((checkpoint) => checkpoint.id === query || checkpoint.messageId === query);
  if (exact) return exact;
  const matches = checkpoints.filter(
    (checkpoint) => checkpoint.id.startsWith(query) || checkpoint.messageId.startsWith(query),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
