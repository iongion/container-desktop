import type { Volume } from "@/env/Types";
import type { ConnectionGroup } from "@/web-app/components/groupedTable/flattenConnectionGroups";
import { sortAlphaNum } from "@/web-app/domain/utils";
import type { MergedResource } from "@/web-app/hooks/useMergedResources";

export type MergedVolume = MergedResource<Volume>;

export interface VolumeConnectionGroup extends ConnectionGroup<MergedVolume> {
  connection: {
    id: string;
    name: string;
    engine: string;
  };
}

export function groupVolumesByConnection(
  volumes: MergedVolume[],
  compareRows: (a: MergedVolume, b: MergedVolume) => number,
): VolumeConnectionGroup[] {
  const byConnection = new Map<string, VolumeConnectionGroup>();
  for (const volume of volumes) {
    let group = byConnection.get(volume.connectionId);
    if (!group) {
      group = {
        key: volume.connectionId,
        connection: {
          id: volume.connectionId,
          name: volume.connectionName,
          engine: `${volume.engine}`,
        },
        items: [],
      };
      byConnection.set(volume.connectionId, group);
    }
    group.items.push(volume);
  }
  const groups = [...byConnection.values()];
  for (const group of groups) {
    group.items.sort(compareRows);
  }
  groups.sort((a, b) => sortAlphaNum(a.connection.name, b.connection.name));
  return groups;
}
