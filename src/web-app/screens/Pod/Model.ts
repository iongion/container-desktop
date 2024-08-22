import { Action, Computed, Thunk, action, computed, thunk } from "easy-peasy";

import { CreatePodOptions, FetchPodOptions } from "@/container-client/Api.clients";
import { Pod, PodStatusList } from "@/env/Types";
import { AppRegistry, ResetableModel } from "@/web-app/domain/types";
import { sortAlphaNum } from "@/web-app/domain/utils";

export interface PodsModelState {
  pods: Pod[];
  podsMap: { [key: string]: Pod };
}

export interface PodsModel extends PodsModelState, ResetableModel<PodsModel> {
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

export const createModel = async (registry: AppRegistry): Promise<PodsModel> => ({
  pods: [],
  podsMap: {},
  // Actions
  reset: action((state) => {
    state.pods = [];
    state.podsMap = {};
  }),
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
        return state.pods.sort((a, b) => sortAlphaNum(a.Name, b.Name));
      }
      return state.pods
        .sort((a, b) => sortAlphaNum(a.Name, b.Name))
        .filter((it) => {
          const haystacks = [it.Name, it.Id].map((t) => t.toLowerCase());
          const matching = haystacks.find((it) => it.includes(searchTerm));
          return !!matching;
        });
    };
  }),

  // Thunks
  podsFetch: thunk(async (actions) => {
    return registry.withPending(async () => {
      const pods = await registry.getApi().getPods();
      actions.setPods(pods);
      return pods;
    });
  }),
  podFetch: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const pod = await registry.getApi().getPod(options.Id);
      if (options.withProcesses) {
        try {
          const processes = await registry.getApi().getPodProcesses(options.Id);
          pod.Processes = processes;
        } catch (error: any) {
          console.error("Unable to load processes", error);
        }
      }
      if (options.withKube) {
        try {
          const generation = await registry.getApi().generateKube({ entityId: options.Id });
          pod.Kube = generation.success ? generation.stdout : "";
        } catch (error: any) {
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
          const logs = await registry.getApi().getPodLogs(options.Id, tail);
          pod.Logs = logs;
        } catch (error: any) {
          console.error("Unable to load logs", error);
        }
      }
      actions.podUpdate(pod);
      return pod;
    })
  ),
  podFetchProcesses: thunk(async (actions, pod) =>
    registry.withPending(async () => {
      const flag = false;
      if (pod.Id) {
        const processes = await registry.getApi().getPodProcesses(pod.Id);
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
        flag = await registry.getApi().pausePod(pod.Id);
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
        flag = await registry.getApi().unpausePod(pod.Id);
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
        flag = await registry.getApi().stopPod(pod.Id);
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
        flag = await registry.getApi().killPod(pod.Id);
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
        flag = await registry.getApi().restartPod(pod.Id);
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
        flag = await registry.getApi().removePod(pod.Id);
      }
      if (flag) {
        actions.podDelete(pod);
      }
      return flag;
    })
  ),
  podCreate: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const create = await registry.getApi().createPod(options);
      return create;
    })
  )
});
