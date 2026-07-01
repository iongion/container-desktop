// Row windowing for the native Blueprint <HTMLTable> list screens. Replaces the progressive-reveal
// hook (which still ended with every row in the DOM) with true virtualization: only the rows in (and
// just around) the viewport are rendered, between two height-reserving spacer <tr>s. Native table
// layout, sticky <thead>, the CSS-driven column widths and (index-driven) striping are all preserved —
// see App.css `[data-windowed]`. Built on @tanstack/react-virtual.

import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState } from "react";

import { computeSpacers } from "./computeSpacers";

const DEFAULT_ESTIMATE_ROW_HEIGHT = 28;
const DEFAULT_OVERSCAN = 8;

// --- List scroll restoration (list → detail → back) --------------------------------------------------
// Uses @tanstack/react-virtual's own state-persistence API — no custom scroll wrangling. On unmount we
// snapshot the virtualizer's *measured* row sizes (`takeSnapshot()`) plus its `scrollOffset`, keyed per
// list view; on the next mount we feed them straight back as `initialMeasurementsCache` + `initialOffset`.
// Because the real heights are seeded, `getTotalSize()` is correct from first paint, so the saved pixel
// offset is reachable and the virtualizer re-applies it in a layout effect *before* paint (`_willUpdate`
// -> `_scrollToOffset`). Result: exact restore, no flash, no drift, and deep offsets (the very end) land.
// This is the pattern documented in the TanStack Virtual "Virtualizer" API guide (takeSnapshot).
//
// The key is captured on the FIRST render: by unmount `window.location.hash` has already advanced to the
// detail route, so computing it late would key under the wrong screen. connId is stripped so the header
// back-chevron (history.back) and a breadcrumb "list" crumb (which carries connId) resolve to one key.
type ListMeasurementsSnapshot = ReturnType<Virtualizer<HTMLElement, HTMLTableRowElement>["takeSnapshot"]>;
interface ListScrollState {
  snapshot: ListMeasurementsSnapshot;
  offset: number;
}
const scrollStates = new Map<string, ListScrollState>();

function listScrollKey(scrollKey?: string): string {
  const raw = window.location.hash || window.location.pathname || "";
  const q = raw.indexOf("?");
  let path = raw;
  let query = "";
  if (q !== -1) {
    path = raw.slice(0, q);
    const params = new URLSearchParams(raw.slice(q + 1));
    params.delete("connId");
    query = params.toString();
  }
  const base = query ? `${path}?${query}` : path;
  return scrollKey ? `${base}::${scrollKey}` : base;
}

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
  /** Disambiguates scroll restoration when one route hosts two lists (Registry: "search"/"sources"). */
  scrollKey?: string;
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
  scrollKey,
}: UseWindowedRowsParams<T>): WindowedRows<T> {
  const getItemKey = useCallback((index: number) => getRowKey(rows[index], index), [getRowKey, rows]);
  const estimateSize = useCallback(
    (index: number) => estimateRowHeight?.(rows[index], index) ?? DEFAULT_ESTIMATE_ROW_HEIGHT,
    [estimateRowHeight, rows],
  );

  // Capture the restore key + any previously-saved state ONCE, on the first render — while the hash is
  // still this list's route (see note above). Reused verbatim to seed the virtualizer below.
  const keyRef = useRef<string | null>(null);
  const savedRef = useRef<ListScrollState | undefined>(undefined);
  if (keyRef.current === null) {
    keyRef.current = listScrollKey(scrollKey);
    savedRef.current = scrollStates.get(keyRef.current);
  }

  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement,
    estimateSize,
    getItemKey,
    overscan,
    scrollMargin,
    enabled,
    // Restore the prior list position via the framework's own persistence API: the measured heights make
    // the total size correct from first paint, so the saved pixel offset (re-applied by the virtualizer
    // on mount) lands exactly. Absent (first visit) -> the defaults (empty cache, offset 0) = top.
    initialMeasurementsCache: savedRef.current?.snapshot,
    initialOffset: savedRef.current?.offset ?? 0,
  });

  // Persist on unmount. The key was captured at mount; the virtualizer is read through a ref so the
  // one-shot cleanup always sees the live instance. `takeSnapshot()`/`scrollOffset` stay valid after the
  // adapter's own unmount cleanup — it tears down listeners but never clears the measurement caches.
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
  useEffect(() => {
    return () => {
      const key = keyRef.current;
      if (!key) {
        return;
      }
      const instance = virtualizerRef.current;
      scrollStates.set(key, { snapshot: instance.takeSnapshot(), offset: instance.scrollOffset ?? 0 });
    };
  }, []);

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
 * Wires a windowed table's scroll plumbing: a callback ref for the scroll container, a callback ref for
 * the <thead> (so the sticky-header height is measured even across the empty↔non-empty table transition),
 * and the resulting `scrollMargin`. Call once per scroll container. Scroll *restoration* is handled by
 * `useWindowedRows` (which owns the virtualizer) via @tanstack/react-virtual's snapshot API, so nothing
 * here touches scrollTop.
 */
export function useTableScroll() {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const scrollElementRef = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
  }, []);

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

  const getScrollElement = useCallback(() => nodeRef.current, []);

  return { scrollElementRef, theadRef, scrollMargin, getScrollElement };
}
