import { Action, Computed, Thunk, action, computed, thunk } from "easy-peasy";

import { Application } from "@/container-client/Application";
import { CreateMachineOptions, FetchMachineOptions, PodmanMachine } from "@/env/Types";
import { AppRegistry, ResetableModel } from "@/web-app/domain/types";

export interface MachinesModelState {
  native: boolean;
  machines: PodmanMachine[];
}

export interface MachinesModel extends MachinesModelState, ResetableModel<MachinesModel> {
  machines: PodmanMachine[];
  // actions
  setMachines: Action<MachinesModel, PodmanMachine[]>;
  machineUpdate: Action<MachinesModel, Partial<PodmanMachine>>;
  machineDelete: Action<MachinesModel, Partial<PodmanMachine>>;
  // thunks
  machinesFetch: Thunk<MachinesModel>;
  machineInspect: Thunk<MachinesModel, FetchMachineOptions>;
  machineCreate: Thunk<MachinesModel, CreateMachineOptions>;
  machineRemove: Thunk<MachinesModel, Partial<PodmanMachine>>;
  machineStop: Thunk<MachinesModel, Partial<PodmanMachine>>;
  machineRestart: Thunk<MachinesModel, Partial<PodmanMachine>>;
  machineConnect: Thunk<MachinesModel, Partial<PodmanMachine>>;
  machinesSearchByTerm: Computed<MachinesModel, (searchTerm: string) => PodmanMachine[]>;
}

export const createModel = async (registry: AppRegistry): Promise<MachinesModel> => {
  const instance = Application.getInstance();
  const native = await instance.isNative();
  return {
    native,
    machines: [],
    // actions
    reset: action((state) => {
      state.machines = [];
    }),
    setMachines: action((state, machines) => {
      state.machines = machines;
    }),
    machineUpdate: action((state, machine) => {
      const existing = state.machines.find((it) => it.Name === machine.Name);
      if (existing) {
        // Transfer all keys
        Object.entries(machine).forEach(([k, v]) => {
          (existing as any)[k] = v;
        });
      }
    }),
    machineDelete: action((state, machine) => {
      const existingPos = state.machines.findIndex((it) => it.Name === machine.Name);
      if (existingPos !== -1) {
        state.machines.splice(existingPos, 1);
      }
    }),
    // thunks

    machinesFetch: thunk(async (actions) =>
      registry.withPending(async () => {
        const instance = Application.getInstance();
        const machines = await instance.getPodmanMachines();
        actions.setMachines(machines);
        return machines;
      })
    ),
    machineStop: thunk(async (actions, options) =>
      registry.withPending(async () => {
        let stopped = false;
        if (options.Name) {
          const instance = Application.getInstance();
          stopped = await instance.stopPodmanMachine(options.Name);
          if (stopped) {
            actions.machineUpdate({ Name: options.Name, Running: false });
          }
        }
        return stopped;
      })
    ),
    machineRestart: thunk(async (actions, options) =>
      registry.withPending(async () => {
        let restarted = false;
        if (options.Name) {
          const instance = Application.getInstance();
          restarted = await instance.restartPodmanMachine(options.Name);
        }
        return restarted;
      })
    ),
    machineConnect: thunk(async (actions, options) =>
      registry.withPending(async () => {
        let connected = false;
        if (options.Name) {
          const instance = Application.getInstance();
          connected = await instance.connectToPodmanMachine(options.Name);
        }
        return connected;
      })
    ),
    machineInspect: thunk(async (actions, options) =>
      registry.withPending(async () => {
        const instance = Application.getInstance();
        const machine = await instance.getPodmanMachineInspect(options.Name);
        return machine;
      })
    ),
    machineCreate: thunk(async (actions, options) =>
      registry.withPending(async () => {
        const instance = Application.getInstance();
        const created = await instance.createPodmanMachine(options);
        return created;
      })
    ),
    machineRemove: thunk(async (actions, options) =>
      registry.withPending(async () => {
        let removed = false;
        if (options.Name) {
          const instance = Application.getInstance();
          removed = await instance.removePodmanMachine(options.Name);
          if (removed) {
            actions.machineDelete(options);
          }
        }
        return removed;
      })
    ),
    machinesSearchByTerm: computed((state) => {
      return (searchTerm: string) => {
        if (!searchTerm) {
          return state.machines;
        }
        return state.machines.filter((it) => {
          const haystacks = [it.Name, it.VMType].map((t) => t.toLowerCase());
          const matching = haystacks.find((it) => it.includes(searchTerm));
          return !!matching;
        });
      };
    })
  };
};
