// Pure coordinate layout for a Run DAG. React Flow positions nodes by absolute x/y rather than flow layout,
// so the waves computed by runTaskWaves are mapped here to a column-per-wave grid: wave index -> column x, position
// in the wave -> stacked row y, with room reserved above each column for its wave label. Kept pure (ids in, points
// out) so the geometry is unit-testable without rendering the canvas.

// Column = one wave. Width matches the task card's min width; the gap matches the old flexbox wave gap so the
// canvas reads exactly like the previous columns.
export const GRAPH_COLUMN_WIDTH = 190;
export const GRAPH_COLUMN_GAP = 34;
// Row height reserved per stacked node (the card is ~49px; the extra keeps a comfortable vertical rhythm and a
// margin for a title that wraps to a second line without overlapping its neighbour).
export const GRAPH_ROW_HEIGHT = 60;
export const GRAPH_ROW_GAP = 10;
// Space above the first node of every column for the "Wave n" label node.
export const GRAPH_WAVE_LABEL_OFFSET = 22;

export interface GraphNodePosition {
  id: string;
  x: number;
  y: number;
}

export interface GraphWaveAnchor {
  index: number;
  x: number;
  y: number;
}

export interface RunGraphLayout {
  nodes: GraphNodePosition[];
  waves: GraphWaveAnchor[];
  width: number;
  height: number;
}

// Map waves (arrays of task ids, already ordered by runTaskWaves) to node positions and per-wave label anchors.
export function runGraphLayout(waves: readonly (readonly string[])[]): RunGraphLayout {
  const nodes: GraphNodePosition[] = [];
  const waveAnchors: GraphWaveAnchor[] = [];
  let maxRows = 0;
  waves.forEach((wave, column) => {
    const x = column * (GRAPH_COLUMN_WIDTH + GRAPH_COLUMN_GAP);
    waveAnchors.push({ index: column, x, y: 0 });
    wave.forEach((id, row) => {
      nodes.push({ id, x, y: GRAPH_WAVE_LABEL_OFFSET + row * (GRAPH_ROW_HEIGHT + GRAPH_ROW_GAP) });
    });
    maxRows = Math.max(maxRows, wave.length);
  });
  const columns = waves.length;
  const width = columns === 0 ? 0 : columns * GRAPH_COLUMN_WIDTH + (columns - 1) * GRAPH_COLUMN_GAP;
  const height =
    maxRows === 0 ? 0 : GRAPH_WAVE_LABEL_OFFSET + maxRows * GRAPH_ROW_HEIGHT + (maxRows - 1) * GRAPH_ROW_GAP;
  return { nodes, waves: waveAnchors, width, height };
}
