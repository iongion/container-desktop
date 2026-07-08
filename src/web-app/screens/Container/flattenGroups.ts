// Flattens the Containers screen's ContainerGroup[] into a single ordered list of "visual row"
// descriptors — the exact sequence of <tr>s the table renders today: a group-header row before the
// first member of a multi-item group, then each member (omitted when the group is collapsed). This flat
// list is what the windowing layer (useWindowedRows) measures and slices. Pure → unit-tested.

import type { Container } from "@/env/Types";
import type { MergedResource } from "@/web-app/hooks/useMergedResources";
import type { ContainerGroup } from "@/web-app/Types";

export type MergedContainer = MergedResource<Container>;

export interface ContainerConnectionGroup {
  key: string;
  connection: {
    id: string;
    name: string;
    engine: string;
  };
  groups: ContainerGroup[];
}

export type ContainerRowDescriptor =
  | {
      kind: "connection-header";
      key: string;
      connectionGroup: ContainerConnectionGroup;
      connectionKey: string;
    }
  | {
      kind: "group-header";
      key: string;
      group: ContainerGroup;
      connId: string;
      connectionKey: string;
      groupKey: string;
      isLastInConnection: boolean;
      hasVisibleChildren: boolean;
    }
  | {
      kind: "container";
      key: string;
      container: MergedContainer;
      connId: string;
      connectionKey: string;
      groupKey: string;
      indexInGroup: number;
      isPartOfGroup: boolean;
      isFirst: boolean;
      isLast: boolean;
      isLastGroupInConnection: boolean;
    };

export function flattenGroups(
  connectionGroups: ContainerConnectionGroup[],
  collapse: Record<string, boolean | undefined>,
  getRowKey: (container: MergedContainer) => string,
): ContainerRowDescriptor[] {
  const rows: ContainerRowDescriptor[] = [];
  for (const connectionGroup of connectionGroups) {
    const connectionKey = `connection:${connectionGroup.key}`;
    rows.push({
      kind: "connection-header",
      key: connectionKey,
      connectionGroup,
      connectionKey,
    });
    if (collapse[connectionKey]) {
      continue;
    }
    const lastGroupIndex = connectionGroup.groups.length - 1;
    connectionGroup.groups.forEach((group, groupIndex) => {
      const items = group.Items as MergedContainer[];
      const isPartOfGroup = items.length > 1;
      const connId = items[0]?.connectionId ?? connectionGroup.connection.id;
      const groupName = group.Name ?? group.Id;
      // Connection-qualified collapse key: identically-named groups on different connections (e.g. two
      // compose projects both named "web") must collapse independently, not in lockstep.
      const groupKey = `group:${connId}:${groupName}`;
      const isCollapsed = !!collapse[groupKey];
      const isLastGroupInConnection = groupIndex === lastGroupIndex;
      // The group-header row is emitted once, before the first member of a grouped set.
      if (isPartOfGroup) {
        rows.push({
          kind: "group-header",
          key: `header:${connId}:${groupName}`,
          group,
          connId,
          connectionKey,
          groupKey,
          isLastInConnection: isLastGroupInConnection,
          hasVisibleChildren: !isCollapsed,
        });
      }
      items.forEach((container, indexInGroup) => {
        // A collapsed grouped set shows only its header. Singleton groups intentionally have no inner header,
        // so collapsing their inner key has no visual effect.
        if (isPartOfGroup && isCollapsed) {
          return;
        }
        rows.push({
          kind: "container",
          key: getRowKey(container),
          container,
          connId,
          connectionKey,
          groupKey,
          indexInGroup,
          isPartOfGroup,
          isFirst: indexInGroup === 0,
          isLast: indexInGroup === items.length - 1,
          isLastGroupInConnection,
        });
      });
    });
  }
  return rows;
}
