// components/Bulk/useBulkSelection.ts — thin React wrapper over the uiStore selection slice + the pure
// set-math in selection.ts. Selection is always-on (checkboxes are always shown); the action bar appears
// only when something is selected. `visibleIds` is the current (filtered) id list; the selection is always
// pruned to it so counts/checkboxes stay correct across refreshes and removals. The math is covered by
// selection.test.ts and the store by uiStore.test.ts.

import { useCallback, useMemo } from "react";

import { useUIStore } from "@/web-app/stores/uiStore";
import { headerCheckboxState, pruneIds, toggleId } from "./selection";

const EMPTY: string[] = [];

export function useBulkSelection(scopeId: string, visibleIds: string[]) {
  const stored = useUIStore((state) => state.selectedRows[scopeId] ?? EMPTY);
  const setSelectedRows = useUIStore((state) => state.setSelectedRows);

  const selected = useMemo(() => pruneIds(stored, visibleIds), [stored, visibleIds]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const headerState = useMemo(
    () => headerCheckboxState(selected.length, visibleIds.length),
    [selected.length, visibleIds.length],
  );

  const isSelected = useCallback((id: string) => selectedSet.has(id), [selectedSet]);
  const toggle = useCallback(
    (id: string) => setSelectedRows(scopeId, toggleId(selected, id)),
    [scopeId, selected, setSelectedRows],
  );
  // Toggle a whole subset (e.g. a group): if all are selected, deselect them; otherwise add the missing.
  const toggleMany = useCallback(
    (ids: string[]) => {
      const allSelected = ids.length > 0 && ids.every((id) => selectedSet.has(id));
      if (allSelected) {
        const remove = new Set(ids);
        setSelectedRows(
          scopeId,
          selected.filter((id) => !remove.has(id)),
        );
      } else {
        const merged = [...selected];
        for (const id of ids) {
          if (!selectedSet.has(id)) {
            merged.push(id);
          }
        }
        setSelectedRows(scopeId, merged);
      }
    },
    [scopeId, selected, selectedSet, setSelectedRows],
  );
  const clear = useCallback(() => setSelectedRows(scopeId, EMPTY), [scopeId, setSelectedRows]);
  const toggleAll = useCallback(
    () => setSelectedRows(scopeId, headerState.checked ? EMPTY : [...visibleIds]),
    [scopeId, headerState.checked, visibleIds, setSelectedRows],
  );

  return {
    selectedIds: selectedSet,
    count: selected.length,
    isSelected,
    toggle,
    toggleMany,
    clear,
    toggleAll,
    headerState,
  };
}
