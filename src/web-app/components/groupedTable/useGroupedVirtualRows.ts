// The shared plumbing for a connection-grouped, VIRTUALIZED table — the pattern proven by the Containers list,
// extracted so Mounts, Volumes and Registries all render identically. Bundles: collapse state, the pure
// `flattenConnectionGroups` (group-header + child descriptors), row windowing (`useWindowedRows`) and the scroll
// wiring (`useTableScroll`). Each screen still writes its own <thead> + group-header <tr> + child <tr> using the
// returned `items`/refs — full control of columns, same plumbing, so every grouped table reads the same.

import { useCallback, useMemo, useState } from "react";

import { useTableScroll, useWindowedRows } from "@/web-app/hooks/useWindowedRows";

import { type ConnectionGroup, type ConnectionRowDescriptor, flattenConnectionGroups } from "./flattenConnectionGroups";

// Default first-paint height guesses (px): a group-header band is a touch taller than a data row. Only affects
// the initial paint — real heights are measured. Module-level so the callback identity is stable.
const estimateGroupedRowHeight = (descriptor: ConnectionRowDescriptor<unknown>): number =>
  descriptor.kind === "group-header" ? 34 : 28;
const getDescriptorKey = (descriptor: ConnectionRowDescriptor<unknown>): string => descriptor.key;

export interface UseGroupedVirtualRowsParams<T> {
  groups: ConnectionGroup<T>[];
  /** Connection-qualified, stable per row (e.g. `mergedKey`) — also the row's DOM/selection identity. */
  getRowKey: (item: T, group: ConnectionGroup<T>) => string;
  /** Override the first-paint height estimate per descriptor (px). */
  estimateRowHeight?: (descriptor: ConnectionRowDescriptor<T>) => number;
  /** Disambiguates scroll restoration when one route hosts two lists. */
  scrollKey?: string;
  /** When false the virtualizer idles (e.g. the empty/NonIdealState branch). */
  enabled?: boolean;
  /** When false, render one flat list with no connection group headers (see resolveGroupByConnection). */
  grouped?: boolean;
  /** In flat mode, sort across every connection's items (one global sort). Omit to keep per-connection order. */
  flatSort?: (a: T, b: T) => number;
}

export function useGroupedVirtualRows<T>({
  groups,
  getRowKey,
  estimateRowHeight,
  scrollKey,
  enabled,
  grouped = true,
  flatSort,
}: UseGroupedVirtualRowsParams<T>) {
  const [collapse, setCollapse] = useState<Record<string, boolean | undefined>>({});
  const toggleGroup = useCallback((groupKey: string) => {
    setCollapse((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }, []);
  const isCollapsed = useCallback((groupKey: string) => !!collapse[groupKey], [collapse]);
  // Stable handler for a group-header <Button data-prefix-group={groupKey}> — mirrors the Containers/Registries
  // toggle wiring, so it never re-creates a closure per group row.
  const onGroupToggleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const groupKey = e.currentTarget.getAttribute("data-prefix-group");
    if (groupKey) {
      setCollapse((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
    }
  }, []);

  const rows = useMemo(
    () => flattenConnectionGroups(groups, collapse, getRowKey, grouped, flatSort),
    [groups, collapse, getRowKey, grouped, flatSort],
  );
  const { scrollElementRef, theadRef, scrollMargin, getScrollElement } = useTableScroll();
  const { items, paddingTop, paddingBottom, measureRef } = useWindowedRows<ConnectionRowDescriptor<T>>({
    rows,
    getScrollElement,
    getRowKey: getDescriptorKey as (row: ConnectionRowDescriptor<T>, index: number) => string,
    estimateRowHeight:
      (estimateRowHeight as (row: ConnectionRowDescriptor<T>) => number) ??
      (estimateGroupedRowHeight as (row: ConnectionRowDescriptor<T>) => number),
    scrollMargin,
    enabled: enabled ?? groups.length > 0,
    scrollKey,
  });

  return {
    items,
    paddingTop,
    paddingBottom,
    measureRef,
    scrollElementRef,
    theadRef,
    collapse,
    isCollapsed,
    toggleGroup,
    onGroupToggleClick,
  };
}
