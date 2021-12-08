// vendors
import { Action, Thunk, Computed, action, thunk, computed } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { Container, ContainerStats } from "../../Types";
import { FetchContainerOptions, CreateContainerOptions } from "../../Api.clients";

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
  // Thunks
  containersFetch: Thunk<ContainersModel>;
  containerFetch: Thunk<ContainersModel, FetchContainerOptions>;
  containerStop: Thunk<ContainersModel, Partial<Container>>;
  containerRestart: Thunk<ContainersModel, Partial<Container>>;
  containerRemove: Thunk<ContainersModel, Partial<Container>>;
  containerCreate: Thunk<ContainersModel, CreateContainerOptions>;
  containerConnect: Thunk<ContainersModel, Partial<Container>>;
}

export const createModel = (registry: AppRegistry): ContainersModel => ({
  containers: [],
  containersMap: {},
  // Actions
  setContainers: action((state, containers) => {
    state.containers = containers;
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
      return state.containers.filter((it) => {
        const haystacks = [it.Names[0] || "", it.Image, it.Id, `${it.Pid}`, `${it.Size}`].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  }),

  // Thunks
  containersFetch: thunk(async (actions) => {
    console.debug(">>>>>>>>>>>> Fetching containers");
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
      actions.containerUpdate(hydrated);
      return hydrated;
    })
  ),
  containerStop: thunk(async (actions, container) =>
    registry.withPending(async () => {
      let removed = false;
      if (container.Id) {
        removed = await registry.api.stopContainer(container.Id);
      }
      if (removed) {
        actions.containerDelete(container);
      }
      return removed;
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
      const created = await registry.api.createContainer(options);
      return created;
    })
  ),
  containerConnect: thunk(async (actions, options) =>
    registry.withPending(async () => {
      let connected = false;
      if (options.Id) {
        const result = await registry.api.connectToContainer(options.Id);
        console.debug("Connect result", result);
        connected = true;
      } else {
        console.warn("Unable to connect to container without name", options);
      }
      return connected;
    })
  )
});
