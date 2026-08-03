import { describe, expect, it } from "vitest";

import {
  GRAPH_COLUMN_GAP,
  GRAPH_COLUMN_WIDTH,
  GRAPH_ROW_GAP,
  GRAPH_ROW_HEIGHT,
  GRAPH_WAVE_LABEL_OFFSET,
  runGraphLayout,
} from "./runGraphLayout";

describe("runGraphLayout", () => {
  it("returns an empty layout for no waves", () => {
    expect(runGraphLayout([])).toEqual({ nodes: [], waves: [], width: 0, height: 0 });
  });

  it("stacks a single wave's nodes in one column below the wave label", () => {
    const layout = runGraphLayout([["a", "b"]]);
    expect(layout.nodes).toEqual([
      { id: "a", x: 0, y: GRAPH_WAVE_LABEL_OFFSET },
      { id: "b", x: 0, y: GRAPH_WAVE_LABEL_OFFSET + GRAPH_ROW_HEIGHT + GRAPH_ROW_GAP },
    ]);
    expect(layout.waves).toEqual([{ index: 0, x: 0, y: 0 }]);
  });

  it("places each wave in its own column, gap between columns", () => {
    const layout = runGraphLayout([["a"], ["b"]]);
    const secondColumnX = GRAPH_COLUMN_WIDTH + GRAPH_COLUMN_GAP;
    expect(layout.nodes).toEqual([
      { id: "a", x: 0, y: GRAPH_WAVE_LABEL_OFFSET },
      { id: "b", x: secondColumnX, y: GRAPH_WAVE_LABEL_OFFSET },
    ]);
    expect(layout.waves).toEqual([
      { index: 0, x: 0, y: 0 },
      { index: 1, x: secondColumnX, y: 0 },
    ]);
  });

  it("sizes the content to the widest row-count and column-count", () => {
    const layout = runGraphLayout([["a", "b"], ["c"]]);
    expect(layout.width).toBe(2 * GRAPH_COLUMN_WIDTH + GRAPH_COLUMN_GAP);
    expect(layout.height).toBe(GRAPH_WAVE_LABEL_OFFSET + 2 * GRAPH_ROW_HEIGHT + GRAPH_ROW_GAP);
  });
});
