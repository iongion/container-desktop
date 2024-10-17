import { IconNames } from "@blueprintjs/icons";
import * as async from "async";
import { type Action, type Computed, type Thunk, action, computed, thunk } from "easy-peasy";
import { v4 } from "uuid";

import type { CreateContainerOptions, FetchContainerOptions } from "@/container-client/Api.clients";
import { type Container, ContainerStateList, type ContainerStats } from "@/env/Types";
import { deepMerge } from "@/utils";
import type { AppRegistry, ResetableModel } from "@/web-app/domain/types";
import { sortAlphaNum } from "@/web-app/domain/utils";
import type { ContainerGroup } from "@/web-app/Types";

const createContainerSearchFilter = (searchTerm: string) => {
  return (it: Container) => {
    const haystacks = [it.Names[0] || "", it.Image, it.Id, `${it.Pid}`, `${it.Size}`].map((t) => t.toLowerCase());
    const matching = haystacks.find((it) => it.includes(searchTerm));
    return !!matching;
  };
};

export interface ContainersModelState {
  version?: string;
  containers: Container[];
  containersMap: { [key: string]: Container };
}

export interface ContainersModel extends ContainersModelState, ResetableModel<ContainersModel> {
  // Actions
  setContainers: Action<ContainersModel, Container[]>;
  containerUpdate: Action<ContainersModel, Partial<Container>>;
  containerDelete: Action<ContainersModel, Partial<Container>>;
  containersSearchByTerm: Computed<ContainersModel, (searchTerm: string) => Container[]>;
  containersGroupedByStrategy: Computed<ContainersModel, (searchTerm: string) => ContainerGroup[]>;
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

export const createModel = async (registry: AppRegistry): Promise<ContainersModel> => {
  return {
    containers: [],
    containersMap: {},
    // Actions
    reset: action((state) => {
      state.containers = [];
      state.containersMap = {};
    }),
    setContainers: action((state, containers) => {
      state.containers = containers.sort((a, b) => {
        if (a.Computed.Name && b.Computed.Name) {
          return sortAlphaNum(a.Computed.Name, b.Computed.Name);
        }
        return sortAlphaNum(a.CreatedAt, b.CreatedAt);
      });
    }),
    containerUpdate: action((state, container) => {
      const existing = state.containers.find((it) => it.Id === container.Id);
      if (existing) {
        // Transfer all keys
        Object.entries(container).forEach(([k, v]) => {
          (existing as any)[k] = v;
        });
        // existing.Logs = existing.Logs || [];
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
    containersGroupedByStrategy: computed((state) => {
      return (searchTerm: string) => {
        let source: Container[] = state.containers;
        if (searchTerm) {
          source = state.containers.filter(createContainerSearchFilter(searchTerm));
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
              },
              Weight: 1000,
            };
            groups.push(group);
            groupsMap[it.Computed.Group] = group;
          }
          if (typeof it.State === "object") {
            group.Report[it.State.Status] += 1;
          } else {
            group.Report[it.State] += 1;
          }
          if (group.Items.length > 0) {
            group.Weight = -1;
          }
          if (group.Name === "Pod infrastructure") {
            group.Weight = -100;
            group.Icon = IconNames.CUBE_ADD;
          }
          group.Items.push(it);
        });
        groups = groups.sort((a, b) => sortAlphaNum(a.Name || "", b.Name || ""));
        groups = groups.sort((a, b) => a.Weight - b.Weight);
        return groups;
      };
    }),

    // Thunks
    containersFetch: thunk(async (actions) => {
      return registry.withPending(async () => {
        const client = await registry.getContainerClient();
        const containers = await client.getContainers();
        actions.setContainers(containers);
        return containers;
      });
    }),
    containerFetch: thunk(async (actions, options) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        // container itself
        const container = await client.getContainer(options.Id);
        // logs
        let logs: any = [];
        try {
          logs = options.withLogs ? await client.getContainerLogs(options.Id) : [];
        } catch (error: any) {
          console.error("Unable to retrieve logs", error);
        }
        // stats
        let stats: ContainerStats | null = null;
        try {
          stats = options.withStats ? await client.getContainerStats(options.Id) : null;
        } catch (error: any) {
          console.error("Unable to retrieve stats", error);
        }
        // processes
        let processes: any = [];
        try {
          if (container.State === "running" || (container as any).State.Status === "running") {
            processes = options.withProcesses ? await client.getContainerProcesses(options.Id) : null;
          } else {
            processes = [];
          }
        } catch (error: any) {
          console.error("Unable to retrieve processes", error);
        }
        const hydrated: Container = {
          ...container,
          Logs: logs,
          Stats: stats,
          Processes: processes,
        };
        if (options.withKube) {
          const generation = await client.generateKube({
            entityId: options.Id,
          });
          hydrated.Kube = generation.success ? generation.stdout : "";
        }
        actions.containerUpdate(hydrated);
        return hydrated;
      }),
    ),
    containerPause: thunk(async (actions, container) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        let removed = false;
        if (container.Id) {
          removed = await client.pauseContainer(container.Id);
          if (removed) {
            const freshContainer = await client.getContainer(container.Id);
            actions.containerUpdate(freshContainer);
          }
        }
        return removed;
      }),
    ),
    containerUnpause: thunk(async (actions, container) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        let updated = false;
        if (container.Id) {
          updated = await client.unpauseContainer(container.Id);
          if (updated) {
            const freshContainer = await client.getContainer(container.Id);
            actions.containerUpdate(freshContainer);
          }
        }
        return updated;
      }),
    ),
    containerStop: thunk(async (actions, container) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        let stopped = false;
        if (container.Id) {
          stopped = await client.stopContainer(container.Id);
          if (stopped) {
            const freshContainer = await client.getContainer(container.Id);
            actions.containerUpdate(freshContainer);
          }
        }
        return stopped;
      }),
    ),
    containerRestart: thunk(async (actions, container) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        let restarted = false;
        if (container.Id) {
          restarted = await client.restartContainer(container.Id);
          if (restarted) {
            const freshContainer = await client.getContainer(container.Id);
            actions.containerUpdate(freshContainer);
          }
        }
        return restarted;
      }),
    ),
    containerRemove: thunk(async (actions, container) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        let removed = false;
        if (container.Id) {
          removed = await client.removeContainer(container.Id);
        }
        if (removed) {
          actions.containerDelete(container);
        }
        return removed;
      }),
    ),
    containerCreate: thunk(async (actions, options) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        if (options.Amount > 1) {
          const creators = Array.from({ length: options.Amount }).map((_, index) => {
            const instanceOptions = deepMerge({}, options);
            if (instanceOptions.Name) {
              instanceOptions.Name = instanceOptions.Name.replace(/\${index}/gi, `${index}`);
            }
            if (instanceOptions.PortMappings.length > 0) {
              // Assign unique host ports based on index
              instanceOptions.PortMappings = instanceOptions.PortMappings.map((mapping) => {
                const hostPort = mapping.host_port || 0;
                return { ...mapping, host_port: hostPort + index };
              });
            }
            return instanceOptions;
          });
          const creatorCallbacks = creators.map((creatorOptions) => (cb: any) => {
            return client
              .createContainer(creatorOptions)
              .then((created) => {
                cb(null, created);
              })
              .catch(cb);
          });
          const results = await async.parallel(creatorCallbacks);
          return {
            created: results.filter((it: any) => it.created).length === results.length,
            started: results.filter((it: any) => it.started).length === results.length,
          };
        }
        const create = await client.createContainer(options);
        return create;
      }),
    ),
    containerConnect: thunk(async (actions, options) =>
      registry.withPending(async () => {
        let connected = false;
        if (options.Id) {
          const client = await registry.getContainerClient();
          connected = await client.connectToContainer(options);
        } else {
          console.warn("Unable to connect to container without name", options);
        }
        return connected;
      }),
    ),
  };
};
