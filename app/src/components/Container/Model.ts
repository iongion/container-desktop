// vendors
import { Action, Thunk, Computed, action, thunk, computed, createTypedHooks } from "easy-peasy";
// project
import { AppModelAccessor } from "../../domain/types";
import { api, withPending } from "../../domain/client";
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
  // Thunks
  containersFetch: Thunk<ContainersModel>;
  containerFetch: Thunk<ContainersModel, FetchContainerOptions>;
  containerStop: Thunk<ContainersModel, Partial<Container>>;
  containerRestart: Thunk<ContainersModel, Partial<Container>>;
  containerRemove: Thunk<ContainersModel, Partial<Container>>;
  containerCreate: Thunk<ContainersModel, CreateContainerOptions>;
  containersSearchByTerm: Computed<ContainersModel, (searchTerm: string) => Container[]>;
  containerConnect: Thunk<ContainersModel, Partial<Container>>;
}

export const createModel = (accessor: AppModelAccessor): ContainersModel => ({
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

  // Thunks
  containersFetch: thunk(async (actions) =>
    withPending(actions, async () => {
      const containers = await api.getContainers();
      actions.setContainers(containers);
      return containers;
    })
  ),
  containersSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      return state.containers.filter((it) => {
        const haystacks = [it.Names[0] || "", it.Image, it.Id, `${it.Pid}`, `${it.Size}`].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  }),
  containerFetch: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let logs: string[] = [];
      try {
        logs = options.withLogs ? await api.getContainerLogs(options.Id) : [];
      } catch (error) {
        console.error("Unable to retrieve logs", error);
      }
      let stats: ContainerStats | null = null;
      try {
        stats = options.withStats ? await api.getContainerStats(options.Id) : null;
      } catch (error) {
        console.error("Unable to retrieve stats", error);
      }
      const container = await api.getContainer(options.Id);
      const hydrated: Container = { ...container, Logs: logs, Stats: stats };
      actions.containerUpdate(hydrated);
      return hydrated;
    })
  ),
  containerStop: thunk(async (actions, container) =>
    withPending(actions, async () => {
      let removed = false;
      if (container.Id) {
        removed = await api.stopContainer(container.Id);
      }
      if (removed) {
        actions.containerDelete(container);
      }
      return removed;
    })
  ),
  containerRestart: thunk(async (actions, container) =>
    withPending(actions, async () => {
      let restarted = false;
      if (container.Id) {
        restarted = await api.restartContainer(container.Id);
        if (restarted) {
          const freshContainer = await api.getContainer(container.Id);
          actions.containerUpdate(freshContainer);
        }
      }
      return restarted;
    })
  ),
  containerRemove: thunk(async (actions, container) =>
    withPending(actions, async () => {
      let removed = false;
      if (container.Id) {
        removed = await api.removeContainer(container.Id);
      }
      if (removed) {
        actions.containerDelete(container);
      }
      return removed;
    })
  ),
  containerCreate: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const created = await api.createContainer(options);
      return created;
    })
  ),
  containerConnect: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let connected = false;
      if (options.Id) {
        const result = await api.connectToContainer(options.Id);
        console.debug("Connect result", result);
        connected = true;
      } else {
        console.warn("Unable to connect to container without name", options);
      }
      return connected;
    })
  )
});

const typedHooks = createTypedHooks<ContainersModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;

const Factory = { create: (accessor: AppModelAccessor) => createModel(accessor) };

export default Factory;
