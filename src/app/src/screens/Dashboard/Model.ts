// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { ContainerStateList } from "../../Types";

export interface ContainerStats {
  paused: number;
  running: number;
  exited: number;
  created: number;
}
export interface DashboardModelState {
  containerStats: ContainerStats;
}

export interface DashboardModel extends DashboardModelState {
  // Actions
  setContainersStats: Action<DashboardModel, Partial<ContainerStats>>;
  // Thunks
  containersFetchStats: Thunk<DashboardModel>;
}

export const createModel = (registry: AppRegistry): DashboardModel => ({
  containerStats: {
    paused: 0,
    running: 0,
    exited: 0,
    created: 0
  },
  // Actions
  setContainersStats: action((state, value) => {
    if (value.paused !== undefined) {
      state.containerStats.paused = value.paused;
    }
    if (value.running !== undefined) {
      state.containerStats.running = value.running;
    }
    if (value.exited !== undefined) {
      state.containerStats.exited = value.exited;
    }
    if (value.created !== undefined) {
      state.containerStats.created = value.created;
    }
  }),

  // Thunks
  containersFetchStats: thunk(async (actions) =>
    registry.withPending(async () => {
      // TODO: Optimize this - avoid loading all containers data, avoid multi-traversal
      const containers = await registry.api.getContainers();
      const pausedContainers = containers.filter(c => c.DecodedState === ContainerStateList.PAUSED);
      const runningContainers = containers.filter(c => c.DecodedState === ContainerStateList.RUNNING);
      const exitedContainers = containers.filter(c => c.DecodedState === ContainerStateList.EXITED);
      const createdContainers = containers.filter(c => c.DecodedState === ContainerStateList.CREATED);
      actions.setContainersStats({
        paused: pausedContainers.length,
        running: runningContainers.length,
        exited: exitedContainers.length,
        created: createdContainers.length,
      });
      return containers.length;
    })
  )
});
