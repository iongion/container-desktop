// components/Bulk/selection.ts — pure set-math behind useBulkSelection (kept separate so it is unit
// testable without rendering a hook). All functions are referentially stable: pruneIds returns the
// same array when nothing changes, so selection state doesn't churn React renders on every refresh.

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((it) => it !== id) : [...ids, id];
}

export function pruneIds(ids: string[], visible: Iterable<string>): string[] {
  const visibleSet = visible instanceof Set ? visible : new Set(visible);
  const kept = ids.filter((id) => visibleSet.has(id));
  return kept.length === ids.length ? ids : kept;
}

export function headerCheckboxState(
  selectedCount: number,
  visibleCount: number,
): { checked: boolean; indeterminate: boolean } {
  if (selectedCount === 0 || visibleCount === 0) {
    return { checked: false, indeterminate: false };
  }
  if (selectedCount >= visibleCount) {
    return { checked: true, indeterminate: false };
  }
  return { checked: false, indeterminate: true };
}
