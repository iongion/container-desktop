export const DEFAULT_ESTIMATE_ROW_HEIGHT = 28;

// Sum the first-paint height estimate over every row — the content height before real measurement.
export function estimateWindowedContentHeight<T>(
  rows: T[],
  estimateRowHeight?: (row: T, index: number) => number,
): number {
  let total = 0;
  for (let index = 0; index < rows.length; index++) {
    total += estimateRowHeight?.(rows[index], index) ?? DEFAULT_ESTIMATE_ROW_HEIGHT;
  }
  return total;
}

// A saved offset is safe to restore only if the current content is at least tall enough to reach it.
// Content height (not max-scroll = content − viewport) is a deliberately generous bound: an offset that
// sits within the content but past the last viewport clamps harmlessly to the bottom (still valid rows),
// whereas an offset BEYOND the content — the shrunk-list case — is the only one that strands every row
// above the viewport. So that is the single case we reject; everything else restores as before.
export function canRestoreScrollOffset(savedOffset: number, contentHeight: number): boolean {
  return savedOffset <= contentHeight;
}
