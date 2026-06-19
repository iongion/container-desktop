import { useEffect, useMemo, useState } from "react";

const DEFAULT_INITIAL_ROWS = 0;
const DEFAULT_CHUNK_ROWS = 4;

interface ProgressiveTableRowsOptions {
  chunkRows?: number;
  initialRows?: number;
}

function countOneRow(): number {
  return 1;
}

function scheduleTableChunk(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const frame = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frame);
  }
  const timeout = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timeout);
}

export function useProgressiveTableRows<T>(
  rows: T[],
  countRows: (row: T) => number = countOneRow,
  { chunkRows = DEFAULT_CHUNK_ROWS, initialRows = DEFAULT_INITIAL_ROWS }: ProgressiveTableRowsOptions = {},
): T[] {
  const [renderLimit, setRenderLimit] = useState(initialRows);
  const visibleRows = useMemo(() => {
    const result: T[] = [];
    let renderedRows = 0;
    for (const row of rows) {
      if (renderedRows >= renderLimit) {
        break;
      }
      result.push(row);
      renderedRows += countRows(row);
    }
    return result;
  }, [countRows, renderLimit, rows]);
  const totalRows = useMemo(() => rows.reduce((total, row) => total + countRows(row), 0), [countRows, rows]);
  const renderedRows = useMemo(
    () => visibleRows.reduce((total, row) => total + countRows(row), 0),
    [countRows, visibleRows],
  );

  useEffect(() => {
    if (renderedRows >= totalRows) {
      return undefined;
    }
    return scheduleTableChunk(() => {
      setRenderLimit((current) => Math.max(current, renderedRows) + chunkRows);
    });
  }, [chunkRows, renderedRows, totalRows]);

  return visibleRows;
}
