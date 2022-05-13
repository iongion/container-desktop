// vendors
import { Action, Thunk, Computed, action, thunk, computed } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { FetchPodOptions, CreatePodOptions } from "../../Api.clients";
import { Pod, PodStatusList } from "../../Types.container-app";

export interface PodsModelState {
  pods: Pod[];
  podsMap: { [key: string]: Pod };
}

export interface PodsModel extends PodsModelState {
  // Actions
  setPods: Action<PodsModel, Pod[]>;
  podUpdate: Action<PodsModel, Partial<Pod>>;
  podDelete: Action<PodsModel, Partial<Pod>>;
  podsSearchByTerm: Computed<PodsModel, (searchTerm: string) => Pod[]>;
  // Thunks
  podsFetch: Thunk<PodsModel>;
  podFetch: Thunk<PodsModel, FetchPodOptions>;
  podFetchProcesses: Thunk<PodsModel, Partial<Pod>>;
  podPause: Thunk<PodsModel, Partial<Pod>>;
  podUnpause: Thunk<PodsModel, Partial<Pod>>;
  podStop: Thunk<PodsModel, Partial<Pod>>;
  podRestart: Thunk<PodsModel, Partial<Pod>>;
  podKill: Thunk<PodsModel, Partial<Pod>>;
  podRemove: Thunk<PodsModel, Partial<Pod>>;
  podCreate: Thunk<PodsModel, CreatePodOptions>;
}

export const createModel = (registry: AppRegistry): PodsModel => ({
  pods: [],
  podsMap: {},
  // Actions
  setPods: action((state, pods) => {
    state.pods = pods;
  }),
  podUpdate: action((state, pod) => {
    const existing = state.pods.find((it) => it.Id === pod.Id);
    if (existing) {
      // Transfer all keys
      Object.entries(pod).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
    }
  }),
  podDelete: action((state, pod) => {
    const existingPos = state.pods.findIndex((it) => it.Id === pod.Id);
    if (existingPos !== -1) {
      state.pods.splice(existingPos, 1);
    }
  }),
  podsSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      if (!searchTerm) {
        return state.pods;
      }
      return state.pods.filter((it) => {
        const haystacks = [it.Name, it.Id].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  }),

  // Thunks
  podsFetch: thunk(async (actions) => {
    return registry.withPending(async () => {
      const pods = await registry.api.getPods();
      actions.setPods(pods);
      return pods;
    });
  }),
  podFetch: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const pod = await registry.api.getPod(options.Id);
      if (options.withProcesses) {
        try {
            const processes = await registry.api.getPodProcesses(options.Id);
            pod.Processes = processes;
        } catch (error) {
          console.error("Unable to load processes", error);
        }
      }
      if (options.withKube) {
        try {
          const generation = await registry.api.generateKube({ entityId: options.Id });
          pod.Kube = generation.success ? generation.stdout : "";
        } catch (error) {
          console.error("Unable to load kube", error);
          pod.Kube = "";
        }
      }
      if (options.withLogs) {
        try {
          let tail = 100;
          if (options.withLogs !== undefined && options.withLogs !== true) {
            tail = options.withLogs.Tail;
          }
          const logs = await registry.api.getPodLogs(options.Id, tail);
          pod.Logs = logs;
        } catch (error) {
          console.error("Unable to load logs", error);
        }
      }
      actions.podUpdate(pod);
      return pod;
    })
  ),
  podFetchProcesses: thunk(async (actions, pod) =>
    registry.withPending(async () => {
      let flag = false;
      if (pod.Id) {
        const processes = await registry.api.getPodProcesses(pod.Id);
        if (flag) {
          actions.podUpdate({ Id: pod.Id, Processes: processes });
        }
      }
      return flag;
    })
  ),
  podPause: thunk(async (actions, pod) =>
    registry.withPending(async () => {
      let flag = false;
      if (pod.Id) {
        flag = await registry.api.pausePod(pod.Id);
        if (flag) {
          actions.podUpdate({ Id: pod.Id, Status: PodStatusList.PAUSED });
        }
      }
      return flag;
    })
  ),
  podUnpause: thunk(async (actions, pod) =>
    registry.withPending(async () => {
      let flag = false;
      if (pod.Id) {
        flag = await registry.api.unpausePod(pod.Id);
        if (flag) {
          actions.podUpdate({ Id: pod.Id, Status: PodStatusList.RUNNING });
        }
      }
      return flag;
    })
  ),
  podStop: thunk(async (actions, pod) =>
    registry.withPending(async () => {
      let flag = false;
      if (pod.Id) {
        flag = await registry.api.stopPod(pod.Id);
        if (flag) {
          actions.podUpdate({ Id: pod.Id, Status: PodStatusList.EXITED });
        }
      }
      return flag;
    })
  ),
  podKill: thunk(async (actions, pod) =>
    registry.withPending(async () => {
      let flag = false;
      if (pod.Id) {
        flag = await registry.api.killPod(pod.Id);
        if (flag) {
          actions.podUpdate({ Id: pod.Id, Status: PodStatusList.EXITED });
        }
      }
      return flag;
    })
  ),
  podRestart: thunk(async (actions, pod) =>
    registry.withPending(async () => {
      let flag = false;
      if (pod.Id) {
        flag = await registry.api.restartPod(pod.Id);
        if (flag) {
          actions.podUpdate({ Id: pod.Id, Status: PodStatusList.RUNNING });
        }
      }
      return flag;
    })
  ),
  podRemove: thunk(async (actions, pod) =>
    registry.withPending(async () => {
      let flag = false;
      if (pod.Id) {
        flag = await registry.api.removePod(pod.Id);
      }
      if (flag) {
        actions.podDelete(pod);
      }
      return flag;
    })
  ),
  podCreate: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const create = await registry.api.createPod(options);
      return create;
    })
  ),
});
