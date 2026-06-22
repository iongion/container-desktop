// Spacer-row heights for a windowed <HTMLTable> (see useWindowedRows). Pure so it is unit-tested
// directly without a DOM or the virtualizer.

export interface Spacers {
  /** Height (px) of the leading spacer <tr> — reserves the rows windowed out above the viewport. */
  paddingTop: number;
  /** Height (px) of the trailing spacer <tr> — reserves the rows windowed out below the viewport. */
  paddingBottom: number;
}

// `item.start`/`item.end` and `totalSize` all live in one scroll-space whose origin is `scrollMargin`,
// so the leading spacer subtracts the margin (it's consumed by the sticky <thead>, not by a spacer) and
// the trailing spacer lets the margin cancel. Negative results clamp to 0 (transient mismeasurements).
export function computeSpacers(
  virtualItems: { start: number; end: number }[],
  totalSize: number,
  scrollMargin: number,
): Spacers {
  if (virtualItems.length === 0) {
    return { paddingTop: 0, paddingBottom: 0 };
  }
  const first = virtualItems[0];
  const last = virtualItems[virtualItems.length - 1];
  return {
    paddingTop: Math.max(0, first.start - scrollMargin),
    paddingBottom: Math.max(0, totalSize - last.end),
  };
}
