// Row windowing for the native Blueprint <HTMLTable> list screens. Replaces the progressive-reveal
// hook (which still ended with every row in the DOM) with true virtualization: only the rows in (and
// just around) the viewport are rendered, between two height-reserving spacer <tr>s. Native table
// layout, sticky <thead>, the CSS-driven column widths and (index-driven) striping are all preserved —
// see App.css `[data-windowed]`. Built on @tanstack/react-virtual.

import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useCallback, useRef, useState } from "react";

import { computeSpacers } from "./computeSpacers";

const DEFAULT_ESTIMATE_ROW_HEIGHT = 28;
const DEFAULT_OVERSCAN = 8;

export interface WindowedRowItem<T> {
  row: T;
  /** Absolute index into the full `rows` array — drives keys, measurement and stripe parity. */
  index: number;
  key: string;
}

export interface UseWindowedRowsParams<T> {
  /** The FULL ordered row array (already sorted/filtered/flattened upstream). */
  rows: T[];
  /** Resolves the scroll container (the `overflow:auto` ancestor of the table). */
  getScrollElement: () => HTMLElement | null;
  /** Stable identity per row so the measurement cache + DOM keys survive data churn (never the index). */
  getRowKey: (row: T, index: number) => string;
  /** First-paint height guess per row (px). Only affects initial paint; real heights are measured. */
  estimateRowHeight?: (row: T, index: number) => number;
  /** Distance (px) from the scroll container's top to the first row — i.e. the sticky <thead> height. */
  scrollMargin?: number;
  /** Rows rendered above/below the viewport. */
  overscan?: number;
  /** When false (e.g. the empty/NonIdealState branch) the virtualizer idles. */
  enabled?: boolean;
}

export interface WindowedRows<T> {
  /** The subset of rows to actually render, in order, each carrying its absolute index + stable key. */
  items: WindowedRowItem<T>[];
  /** Height (px) of the leading spacer <tr>. */
  paddingTop: number;
  /** Height (px) of the trailing spacer <tr>. */
  paddingBottom: number;
  /** Attach to EACH rendered row's outer <tr> via `ref={measureRef}` (also set `data-index={index}`). */
  measureRef: (node: HTMLTableRowElement | null) => void;
  /** Escape hatch for remeasure / scrollTo (e.g. collapse, search reset). */
  virtualizer: Virtualizer<HTMLElement, HTMLTableRowElement>;
}

export function useWindowedRows<T>({
  rows,
  getScrollElement,
  getRowKey,
  estimateRowHeight,
  scrollMargin = 0,
  overscan = DEFAULT_OVERSCAN,
  enabled = true,
}: UseWindowedRowsParams<T>): WindowedRows<T> {
  const getItemKey = useCallback((index: number) => getRowKey(rows[index], index), [getRowKey, rows]);
  const estimateSize = useCallback(
    (index: number) => estimateRowHeight?.(rows[index], index) ?? DEFAULT_ESTIMATE_ROW_HEIGHT,
    [estimateRowHeight, rows],
  );

  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement,
    estimateSize,
    getItemKey,
    overscan,
    scrollMargin,
    enabled,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const { paddingTop, paddingBottom } = computeSpacers(virtualItems, virtualizer.getTotalSize(), scrollMargin);
  const items: WindowedRowItem<T>[] = virtualItems.map((vi) => ({
    row: rows[vi.index],
    index: vi.index,
    key: String(vi.key),
  }));

  return { items, paddingTop, paddingBottom, measureRef: virtualizer.measureElement, virtualizer };
}

/**
 * Wires a windowed table's scroll plumbing: a ref for the scroll container, a callback ref for the
 * <thead> (so the sticky-header height is measured even across the empty↔non-empty table transition),
 * and the resulting `scrollMargin`. Call once per scroll container (Registry has two).
 */
export function useTableScroll() {
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Callback ref: fires with the node on mount and null on unmount, so it (re)measures whenever the
  // table appears/disappears — a plain useLayoutEffect wouldn't re-run when the thead first mounts.
  const theadRef = useCallback((node: HTMLTableSectionElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (node) {
      const update = () => setScrollMargin(node.offsetHeight);
      update();
      const observer = new ResizeObserver(update);
      observer.observe(node);
      observerRef.current = observer;
    }
  }, []);

  const getScrollElement = useCallback(() => scrollElementRef.current, []);

  return { scrollElementRef, theadRef, scrollMargin, getScrollElement };
}
