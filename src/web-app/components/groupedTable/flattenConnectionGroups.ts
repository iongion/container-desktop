// Flattens connection-grouped resources into a single ordered list of "visual row" descriptors — the exact
// <tr> sequence a grouped table renders: a connection group-header row, then that connection's item rows
// (omitted when the group is collapsed). This flat list is what the windowing layer (useWindowedRows) measures
// and slices, so grouped tables virtualize like the Containers list. Generic over the item shape; pure →
// unit-tested. Unlike the Containers flatten (header only for multi-item groups), here the CONNECTION is always
// the group, so every group emits a header — even a single-item or empty connection.

export interface ConnectionGroup<T> {
  /** Stable group identity — the connection id. Drives the collapse map + the header key. */
  key: string;
  items: T[];
}

export type ConnectionRowDescriptor<T> =
  | { kind: "group-header"; key: string; groupKey: string; group: ConnectionGroup<T> }
  | { kind: "row"; key: string; groupKey: string; item: T; isFirst: boolean; isLast: boolean };

export function flattenConnectionGroups<T>(
  groups: ConnectionGroup<T>[],
  collapse: Record<string, boolean | undefined>,
  getRowKey: (item: T, group: ConnectionGroup<T>) => string,
): ConnectionRowDescriptor<T>[] {
  const rows: ConnectionRowDescriptor<T>[] = [];
  for (const group of groups) {
    const groupKey = group.key;
    rows.push({ kind: "group-header", key: `header:${groupKey}`, groupKey, group });
    if (collapse[groupKey]) {
      continue;
    }
    const last = group.items.length - 1;
    group.items.forEach((item, index) => {
      rows.push({
        kind: "row",
        key: getRowKey(item, group),
        groupKey,
        item,
        isFirst: index === 0,
        isLast: index === last,
      });
    });
  }
  return rows;
}
