// Container list grouping — turns a flat Container[] into ContainerGroup[] keyed by the normalizer's
// Computed.Group (name prefix before the first "-"/"_", or "Pod infrastructure" for "*-infra").
//
// Extracted verbatim from ManageScreen as the single source of truth for the Containers screen's grouping
// (compose-project / name-prefix groups, "Pod infrastructure" pinned on top). Behavior is unchanged.

import { IconNames } from "@blueprintjs/icons";

import { type Container, ContainerStateList } from "@/env/Types";
import { randomUUID } from "@/utils/randomUUID";
import { sortAlphaNum } from "@/web-app/domain/utils";
import type { SortSpec } from "@/web-app/stores/sortStore";
import type { ContainerGroup } from "@/web-app/Types";
import { compareSortValues, type SortSelectors, sortByField } from "@/web-app/utils/comparators";

export const createContainerSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (it: Container) => {
    const haystacks = [it.Names[0] || "", it.Image, it.Id, `${it.Pid}`, `${it.Size}`].map((t) => t.toLowerCase());
    const matching = haystacks.find((it) => it.includes(query));
    return !!matching;
  };
};

export const containerSortSelectors: SortSelectors<Container> = {
  name: (container) => container.Computed.Name || container.Names[0] || "",
  image: (container) => container.Image,
  pid: (container) => container.Pid,
  state: (container) => container.Computed.DecodedState,
  id: (container) => container.Id,
  created: (container) =>
    typeof container.Created === "string" ? Date.parse(container.Created) : Number(container.Created) * 1000,
};

export function isContainerGroupDirectory(group: ContainerGroup): boolean {
  return group.Name === "Pod infrastructure" || group.Items.length > 1;
}

// A pod's infra ("pause") container — podman implementation detail, not a user workload. Detected by the
// libpod `IsInfra` flag when present, else by the `<pod-id>-infra` name (the docker-compat list omits the
// flag). These are hidden from the Containers list, like Docker Desktop hides pause containers.
export function isInfraContainer(container: Container): boolean {
  if (container.IsInfra) {
    return true;
  }
  const name = (container.Computed?.Name || container.Names?.[0] || "").replace(/^\/+/, "");
  return name.endsWith("-infra");
}

export function compareContainerGroups(sort: SortSpec | undefined) {
  const selector = sort ? containerSortSelectors[sort.field] : undefined;
  const direction = sort?.dir === "desc" ? -1 : 1;
  return (a: ContainerGroup, b: ContainerGroup) => {
    if (a.Name === "Pod infrastructure" && b.Name !== "Pod infrastructure") {
      return -1;
    }
    if (b.Name === "Pod infrastructure" && a.Name !== "Pod infrastructure") {
      return 1;
    }
    const aIsDirectory = isContainerGroupDirectory(a);
    const bIsDirectory = isContainerGroupDirectory(b);
    if (aIsDirectory !== bIsDirectory) {
      return aIsDirectory ? -1 : 1;
    }
    if (sort?.field === "name") {
      return direction * compareSortValues(a.Name || "", b.Name || "");
    }
    if (!aIsDirectory && !bIsDirectory && selector) {
      const sorted = direction * compareSortValues(selector(a.Items[0]), selector(b.Items[0]));
      if (sorted !== 0) {
        return sorted;
      }
    }
    return sortAlphaNum(a.Name || "", b.Name || "");
  };
}

export function groupContainers(
  containers: Container[],
  searchTerm: string,
  sort: SortSpec | undefined,
): ContainerGroup[] {
  let source = [...containers]
    .filter((it) => !isInfraContainer(it)) // pod pause containers are podman noise — never list them
    .sort((a, b) => {
      if (a.Computed.Name && b.Computed.Name) {
        return sortAlphaNum(a.Computed.Name, b.Computed.Name);
      }
      return sortAlphaNum(a.CreatedAt, b.CreatedAt);
    });
  if (searchTerm) {
    source = source.filter(createContainerSearchFilter(searchTerm));
  }
  let groups: ContainerGroup[] = [];
  const groupsMap: { [key: string]: ContainerGroup } = {};
  source.forEach((it) => {
    if (!it.Computed.Group) {
      return;
    }
    let group = groupsMap[it.Computed.Group];
    if (!group) {
      group = {
        Id: randomUUID(),
        Name: it.Computed.Group,
        Items: [],
        Report: {
          [ContainerStateList.CREATED]: 0,
          [ContainerStateList.ERROR]: 0,
          [ContainerStateList.EXITED]: 0,
          [ContainerStateList.PAUSED]: 0,
          [ContainerStateList.RUNNING]: 0,
          [ContainerStateList.DEGRADED]: 0,
          [ContainerStateList.STOPPED]: 0,
        },
        Weight: 1000,
      };
      groups.push(group);
      groupsMap[it.Computed.Group] = group;
    }
    group.Report[it.Computed.DecodedState] += 1;
    if (group.Items.length > 0) {
      group.Weight = -1;
    }
    if (group.Name === "Pod infrastructure") {
      group.Weight = -100;
      group.Icon = IconNames.CUBE_ADD;
    }
    group.Items.push(it);
  });
  if (sort) {
    groups = groups.map((group) => ({
      ...group,
      Items: sortByField(group.Items, sort, containerSortSelectors),
    }));
  }
  groups = groups.sort(compareContainerGroups(sort));
  return groups;
}

// Group each connection's containers independently — so identically-named groups on different engines never
// merge (a Docker "web" project and a Podman "web" project stay separate) — then order the COMBINED set with
// the same comparator, so directory groups (multi-member projects + "Pod infrastructure") always sort before
// singletons across EVERY connection, like folders in a file manager, regardless of the active sort. Grouping
// per connection then concatenating (flatMap alone) would drop a second engine's group below the first
// engine's singletons — this final sort keeps every folder on top.
export function groupContainersAcrossConnections(
  containersByConnection: Container[][],
  searchTerm: string,
  sort: SortSpec | undefined,
): ContainerGroup[] {
  const groups = containersByConnection.flatMap((list) => groupContainers(list, searchTerm, sort));
  return groups.sort(compareContainerGroups(sort));
}
