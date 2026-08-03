// Present build steps in Containerfile order.
//
// Engines don't emit steps in Containerfile order: `docker buildx build --progress=rawjson` emits vertices in
// BuildKit's DAG/solve order — resolved from the target backward — so the numbered steps arrive DESCENDING
// ([5/5] before [1/5]), interleaved with internal vertices (and even their `started` timestamps follow that
// solve order, not execution order). The reliable signal is the Containerfile step number buildx prints in each
// name ("[N/M]"). Sort by it, keep internal setup vertices (load definition/metadata/context, resolve config)
// before the numbered layers and the final export vertex last, and preserve first-seen order on ties. This
// fixes the timeline display AND the order-dependent cache analysis (analyzeCache). Podman/Apple print bare
// instruction names (no "[N/M]") and already parse in order, so they keep their first-seen order → no-op.

import type { BuildStep } from "./types";

// A monotonic sort bucket: numbered layers by their Containerfile position, internal setup before them, the
// final image export after them. Steps in the same bucket keep first-seen order (handled by the stable tie).
function sortKeyFor(step: BuildStep): number {
  const numbered = step.name.match(/\[(\d+)\/\d+\]/);
  if (numbered) {
    return Number(numbered[1]);
  }
  if (/exporting|writing image/i.test(step.name)) {
    return Number.POSITIVE_INFINITY;
  }
  return -1;
}

export function orderBuildSteps(steps: BuildStep[]): BuildStep[] {
  return steps
    .map((step, i) => ({ step, i, key: sortKeyFor(step) }))
    .sort((a, b) => (a.key === b.key ? a.i - b.i : a.key - b.key))
    .map(({ step }) => step);
}
