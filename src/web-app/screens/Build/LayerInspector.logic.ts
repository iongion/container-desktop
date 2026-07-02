// Pure view-model for the layer waterfall. Bars are sized relative to the LARGEST non-empty layer (dive
// style) so the biggest layer is full-width and the rest scale against it. Kept separate from the component
// so the sizing math is unit testable.

import type { LayerAnalysis } from "@/container-client/builder/types";

export interface WaterfallRow {
  index: number;
  createdBy: string;
  size: number;
  empty: boolean;
  percent: number; // 0-100, relative to the largest non-empty layer
  largest: boolean; // the single heaviest layer — its bar is highlighted
}

export function toWaterfallRows(analysis: LayerAnalysis): WaterfallRow[] {
  const max = analysis.largest[0]?.size ?? 0;
  const largestIndex = analysis.largest[0]?.index;
  return analysis.layers.map((layer) => ({
    index: layer.index,
    createdBy: layer.createdBy,
    size: layer.size,
    empty: layer.empty,
    percent: max > 0 ? (layer.size / max) * 100 : 0,
    largest: max > 0 && layer.index === largestIndex,
  }));
}
