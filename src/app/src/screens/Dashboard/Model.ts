// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";

export interface DashboardModelState {
  containersCount: number;
}

export interface DashboardModel extends DashboardModelState {
  // Actions
  setContainersCount: Action<DashboardModel, number>;
  // Thunks
  containersFetchCount: Thunk<DashboardModel>;
}

export const createModel = (registry: AppRegistry): DashboardModel => ({
  containersCount: 0,
  // Actions
  setContainersCount: action((state, value) => {
    state.containersCount = value;
  }),

  // Thunks
  containersFetchCount: thunk(async (actions) =>
    registry.withPending(async () => {
      const containers = await registry.api.getContainers();
      actions.setContainersCount(containers.length);
      return containers.length;
    })
  )
});
