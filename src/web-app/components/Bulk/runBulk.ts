// components/Bulk/runBulk.ts — pure, bounded-concurrency runner for bulk operations.
// Runs `run(item)` across items with at most `concurrency` in flight; partitions results into
// ok/failed (a thrown error OR a falsy resolve counts as failure), preserving input order. No React,
// no toasts — kept pure so it is directly unit-testable.

import type { BulkRunSummary } from "./types";

export async function runBulk<T>(
  items: T[],
  run: (item: T) => Promise<boolean>,
  opts: { concurrency?: number } = {},
): Promise<BulkRunSummary<T>> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const outcomes: ({ ok: true } | { ok: false; error: unknown })[] = new Array(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      try {
        const result = await run(items[index]);
        outcomes[index] = result ? { ok: true } : { ok: false, error: undefined };
      } catch (error) {
        outcomes[index] = { ok: false, error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  const ok: T[] = [];
  const failed: { item: T; error: unknown }[] = [];
  items.forEach((item, index) => {
    const outcome = outcomes[index];
    if (outcome.ok) {
      ok.push(item);
    } else {
      failed.push({ item, error: outcome.error });
    }
  });
  return { ok, failed };
}
