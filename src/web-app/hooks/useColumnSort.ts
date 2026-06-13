import { useCallback } from "react";

import type { ConnectorCapabilities } from "@/env/Types";
import type { SortSpec } from "@/web-app/stores/sortStore";
import { useSortStore } from "@/web-app/stores/sortStore";

export type ColumnSortMode = ConnectorCapabilities["sort"][string];

export interface ColumnSortState {
  sort: SortSpec | undefined;
  clientSort: SortSpec | undefined;
  getColumnSortMode: (field: string) => ColumnSortMode | undefined;
  getColumnSortDirection: (field: string) => SortSpec["dir"] | undefined;
  toggleColumnSort: (field: string) => void;
}

export function getSortMode(
  sortCapabilities: ConnectorCapabilities["sort"] | undefined,
  scope: string,
  field: string,
): ColumnSortMode | undefined {
  return sortCapabilities?.[`${scope}.${field}`] ?? sortCapabilities?.[`${scope}.*`];
}

export function useColumnSort(scope: string, sortCapabilities?: ConnectorCapabilities["sort"]): ColumnSortState {
  const sort = useSortStore((state) => state.sorts[scope]);
  const setSort = useSortStore((state) => state.setSort);
  const getColumnSortMode = useCallback(
    (field: string) => getSortMode(sortCapabilities, scope, field),
    [scope, sortCapabilities],
  );
  const getColumnSortDirection = useCallback(
    (field: string) => (sort?.field === field && getColumnSortMode(field) ? sort.dir : undefined),
    [getColumnSortMode, sort],
  );
  const toggleColumnSort = useCallback(
    (field: string) => {
      if (getColumnSortMode(field)) {
        setSort(scope, field);
      }
    },
    [getColumnSortMode, scope, setSort],
  );
  const clientSort = sort && getColumnSortMode(sort.field) === "client" ? sort : undefined;
  return { sort, clientSort, getColumnSortMode, getColumnSortDirection, toggleColumnSort };
}
