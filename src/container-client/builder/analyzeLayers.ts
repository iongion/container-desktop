// Pure layer analysis over an image's history (docker/podman `image history`). Produces a waterfall-ready
// list with cumulative sizes plus a few waste findings — the largest layer's share (the dive-style "this one
// layer is most of your image" signal) and an excessive-layer-count hint. Pass history base-first for a
// natural base → final waterfall.

import type { ContainerImageHistory } from "@/env/Types";
import type { LayerAnalysis, LayerInfo, LayerWasteFinding } from "./types";

const LARGE_LAYER_SHARE = 0.4;
const MANY_LAYERS = 20;
const TOP_N = 5;

export function analyzeLayers(history: ContainerImageHistory[]): LayerAnalysis {
  const layers: LayerInfo[] = [];
  let cumulative = 0;
  history.forEach((entry, index) => {
    const size = Number(entry.Size) || 0;
    cumulative += size;
    layers.push({
      index,
      id: entry.id && entry.id !== "<missing>" ? entry.id : undefined,
      createdBy: entry.CreatedBy ?? "",
      size,
      cumulativeSize: cumulative,
      empty: size === 0,
      comment: entry.Comment || undefined,
    });
  });

  const totalSize = cumulative;
  const nonEmpty = layers.filter((layer) => !layer.empty);
  const largest = [...nonEmpty].sort((a, b) => b.size - a.size).slice(0, TOP_N);
  const findings: LayerWasteFinding[] = [];

  if (largest.length > 0 && totalSize > 0) {
    const top = largest[0];
    const share = top.size / totalSize;
    if (share >= LARGE_LAYER_SHARE) {
      findings.push({
        kind: "large-layer",
        layerIndex: top.index,
        bytes: top.size,
        message: `Largest layer is ${Math.round(share * 100)}% of the image (${top.createdBy}).`,
      });
    }
  }
  if (nonEmpty.length > MANY_LAYERS) {
    findings.push({
      kind: "many-layers",
      message: `${nonEmpty.length} non-empty layers — consider consolidating RUN steps to cut overhead.`,
    });
  }

  return { layers, totalSize, largest, findings };
}
