// vendors
import { Action, Thunk, Computed, action, thunk, computed } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { FetchContainerOptions, CreateContainerOptions } from "../../Api.clients";
import { Container, ContainerGroup, ContainerStateList, ContainerStats } from "../../Types.container-app";
import { sortAlphaNum } from "../../domain/utils";
import { v4 } from "uuid";


const createContainerSearchFilter = (searchTerm: string) => {
  return (it: Container) => {
    const haystacks = [it.Names[0] || "", it.Image, it.Id, `${it.Pid}`, `${it.Size}`].map((t) => t.toLowerCase());
    const matching = haystacks.find((it) => it.includes(searchTerm));
    return !!matching;
  };
}

export interface ContainersModelState {
  containers: Container[];
  containersMap: { [key: string]: Container };
}

export interface ContainersModel extends ContainersModelState {
  // Actions
  setContainers: Action<ContainersModel, Container[]>;
  containerUpdate: Action<ContainersModel, Partial<Container>>;
  containerDelete: Action<ContainersModel, Partial<Container>>;
  containersSearchByTerm: Computed<ContainersModel, (searchTerm: string) => Container[]>;
  containersGroupedByPrefix: Computed<ContainersModel, (searchTerm: string) => ContainerGroup[]>;
  // Thunks
  containersFetch: Thunk<ContainersModel>;
  containerFetch: Thunk<ContainersModel, FetchContainerOptions>;
  containerPause: Thunk<ContainersModel, Partial<Container>>;
  containerUnpause: Thunk<ContainersModel, Partial<Container>>;
  containerStop: Thunk<ContainersModel, Partial<Container>>;
  containerRestart: Thunk<ContainersModel, Partial<Container>>;
  containerRemove: Thunk<ContainersModel, Partial<Container>>;
  containerCreate: Thunk<ContainersModel, CreateContainerOptions>;
  containerConnect: Thunk<ContainersModel, Container>;
}

export const createModel = (registry: AppRegistry): ContainersModel => ({
  containers: [],
  containersMap: {},
  // Actions
  setContainers: action((state, containers) => {
    state.containers = containers.sort((a, b) => {
      if (a.Computed.Name && b.Computed.Name) {
        return sortAlphaNum(a.Computed.Name, b.Computed.Name);
      }
      return sortAlphaNum(a.CreatedAt, b.CreatedAt);
    })
  }),
  containerUpdate: action((state, container) => {
    const existing = state.containers.find((it) => it.Id === container.Id);
    if (existing) {
      // Transfer all keys
      Object.entries(container).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
      existing.Logs = existing.Logs || [];
      existing.Config = existing.Config || { Env: [] };
    }
  }),
  containerDelete: action((state, container) => {
    const existingPos = state.containers.findIndex((it) => it.Id === container.Id);
    if (existingPos !== -1) {
      state.containers.splice(existingPos, 1);
    }
  }),
  containersSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      if (!searchTerm) {
        return state.containers;
      }
      return state.containers.filter(createContainerSearchFilter(searchTerm));
    };
  }),
  containersGroupedByPrefix: computed((state) => {
    return (searchTerm: string) => {
      let source: Container[] = state.containers;
      if (searchTerm) {
        source = state.containers.filter(createContainerSearchFilter(searchTerm));
      }
      const groups: ContainerGroup[] = [];
      const groupsMap: {[key: string]: ContainerGroup} = {};
      source.forEach((it) => {
        if (!it.Computed.Group) {
          return;
        }
        let group = groupsMap[it.Computed.Group];
        if (!group) {
          group = {
            Id: v4(),
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
            }
          };
          groups.push(group);
          groupsMap[it.Computed.Group] = group;
        }
        if (typeof it.State === "object") {
          group.Report[it.State.Status] += 1;
        } else {
          group.Report[it.State] += 1;
        }
        group.Items.push(it);
      });
      return groups;
    };
  }),

  // Thunks
  containersFetch: thunk(async (actions) => {
    return registry.withPending(async () => {
      const containers = await registry.api.getContainers();
      actions.setContainers(containers);
      return containers;
    });
  }),
  containerFetch: thunk(async (actions, options) =>
    registry.withPending(async () => {
      let logs: string[] = [];
      try {
        logs = options.withLogs ? await registry.api.getContainerLogs(options.Id) : [];
      } catch (error) {
        console.error("Unable to retrieve logs", error);
      }
      let stats: ContainerStats | null = null;
      try {
        stats = options.withStats ? await registry.api.getContainerStats(options.Id) : null;
      } catch (error) {
        console.error("Unable to retrieve stats", error);
      }
      const container = await registry.api.getContainer(options.Id);
      const hydrated: Container = { ...container, Logs: logs, Stats: stats };
      if (options.withKube) {
        const generation = await registry.api.generateKube({ entityId: options.Id });
        hydrated.Kube = generation.success ? generation.stdout : "";
      }
      actions.containerUpdate(hydrated);
      return hydrated;
    })
  ),
  containerPause: thunk(async (actions, container) =>
    registry.withPending(async () => {
      let removed = false;
      if (container.Id) {
        removed = await registry.api.pauseContainer(container.Id);
        if (removed) {
          const freshContainer = await registry.api.getContainer(container.Id);
          actions.containerUpdate(freshContainer);
        }
      }
      return removed;
    })
  ),
  containerUnpause: thunk(async (actions, container) =>
    registry.withPending(async () => {
      let removed = false;
      if (container.Id) {
        removed = await registry.api.unpauseContainer(container.Id);
        if (removed) {
          const freshContainer = await registry.api.getContainer(container.Id);
          actions.containerUpdate(freshContainer);
        }
      }
      return removed;
    })
  ),
  containerStop: thunk(async (actions, container) =>
    registry.withPending(async () => {
      let stopped = false;
      if (container.Id) {
        stopped = await registry.api.stopContainer(container.Id);
        if (stopped) {
          const freshContainer = await registry.api.getContainer(container.Id);
          actions.containerUpdate(freshContainer);
        }
      }
      return stopped;
    })
  ),
  containerRestart: thunk(async (actions, container) =>
    registry.withPending(async () => {
      let restarted = false;
      if (container.Id) {
        restarted = await registry.api.restartContainer(container.Id);
        if (restarted) {
          const freshContainer = await registry.api.getContainer(container.Id);
          actions.containerUpdate(freshContainer);
        }
      }
      return restarted;
    })
  ),
  containerRemove: thunk(async (actions, container) =>
    registry.withPending(async () => {
      let removed = false;
      if (container.Id) {
        removed = await registry.api.removeContainer(container.Id);
      }
      if (removed) {
        actions.containerDelete(container);
      }
      return removed;
    })
  ),
  containerCreate: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const create = await registry.api.createContainer(options);
      return create;
    })
  ),
  containerConnect: thunk(async (actions, options) =>
    registry.withPending(async () => {
      let connected = false;
      if (options.Id) {
        connected = await registry.api.connectToContainer(options);
      } else {
        console.warn("Unable to connect to container without name", options);
      }
      return connected;
    })
  )
});
