// Flattens the Containers screen's ContainerGroup[] into a single ordered list of "visual row"
// descriptors — the exact sequence of <tr>s the table renders today: a group-header row before the
// first member of a multi-item group, then each member (omitted when the group is collapsed). This flat
// list is what the windowing layer (useWindowedRows) measures and slices. Pure → unit-tested.

import type { Container } from "@/env/Types";
import type { MergedResource } from "@/web-app/hooks/useMergedResources";
import type { ContainerGroup } from "@/web-app/Types";

export type MergedContainer = MergedResource<Container>;

export type ContainerRowDescriptor =
  | { kind: "group-header"; key: string; group: ContainerGroup; connId: string; groupKey: string }
  | {
      kind: "container";
      key: string;
      container: MergedContainer;
      connId: string;
      indexInGroup: number;
      isPartOfGroup: boolean;
      isFirst: boolean;
      isLast: boolean;
    };

export function flattenGroups(
  groups: ContainerGroup[],
  collapse: Record<string, boolean | undefined>,
  getRowKey: (container: MergedContainer) => string,
): ContainerRowDescriptor[] {
  const rows: ContainerRowDescriptor[] = [];
  for (const group of groups) {
    const items = group.Items as MergedContainer[];
    const isPartOfGroup = items.length > 1;
    const connId = items[0]?.connectionId ?? "";
    const groupName = group.Name ?? group.Id;
    // Connection-qualified collapse key: identically-named groups on different connections (e.g. two
    // compose projects both named "web") must collapse independently, not in lockstep.
    const groupKey = `${connId}:${groupName}`;
    const isCollapsed = !!collapse[groupKey];
    items.forEach((container, indexInGroup) => {
      // The group-header row is emitted once, before the first member of a grouped set.
      if (isPartOfGroup && indexInGroup === 0) {
        rows.push({ kind: "group-header", key: `header:${connId}:${groupName}`, group, connId, groupKey });
      }
      // A collapsed group shows only its header — members are omitted, exactly as today.
      if (isCollapsed) {
        return;
      }
      rows.push({
        kind: "container",
        key: getRowKey(container),
        container,
        connId,
        indexInGroup,
        isPartOfGroup,
        isFirst: indexInGroup === 0,
        isLast: indexInGroup === items.length - 1,
      });
    });
  }
  return rows;
}
