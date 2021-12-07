// vendors
import { Action, Thunk, Computed, action, thunk, computed, createTypedHooks } from "easy-peasy";
// project
import { AppModelAccessor } from "../../domain/types";
import { api, withPending } from "../../domain/client";
import { Machine } from "../../Types";
import { FetchMachineOptions, CreateMachineOptions } from "../../Api.clients";

export interface MachinesModelState {
  machines: Machine[];
}

export interface MachinesModel extends MachinesModelState {
  machines: Machine[];
  // actions
  setMachines: Action<MachinesModel, Machine[]>;
  machineUpdate: Action<MachinesModel, Partial<Machine>>;
  machineDelete: Action<MachinesModel, Partial<Machine>>;
  // thunks
  machinesFetch: Thunk<MachinesModel>;
  machineFetch: Thunk<MachinesModel, FetchMachineOptions>;
  machineCreate: Thunk<MachinesModel, CreateMachineOptions>;
  machineRemove: Thunk<MachinesModel, Partial<Machine>>;
  machineStop: Thunk<MachinesModel, Partial<Machine>>;
  machineRestart: Thunk<MachinesModel, Partial<Machine>>;
  machineConnect: Thunk<MachinesModel, Partial<Machine>>;
  machinesSearchByTerm: Computed<MachinesModel, (searchTerm: string) => Machine[]>;
}

export const createModel = (accessor: AppModelAccessor): MachinesModel => ({
  machines: [],
  // actions
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
    withPending(actions, async () => {
      const machines = await api.getMachines();
      actions.setMachines(machines);
      return machines;
    })
  ),
  machineStop: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let stopped = false;
      if (options.Name) {
        const result = await api.stopMachine(options.Name);
        console.debug("Stop result", result);
        stopped = true;
      }
      return stopped;
    })
  ),
  machineRestart: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let restarted = false;
      if (options.Name) {
        const result = await api.restartMachine(options.Name);
        console.debug("Restart result", result);
        restarted = true;
      }
      return restarted;
    })
  ),
  machineConnect: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let connected = false;
      if (options.Name) {
        const result = await api.connectToMachine(options.Name);
        console.debug("Connect result", result);
        connected = true;
      }
      return connected;
    })
  ),
  machineFetch: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const machine = await api.getMachine(options.Name);
      return machine;
    })
  ),
  machineCreate: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const created = await api.createMachine(options);
      return created;
    })
  ),
  machineRemove: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let removed = false;
      if (options.Name) {
        removed = await api.removeMachine(options.Name);
        if (removed) {
          actions.machineDelete(options);
        }
      }
      return removed;
    })
  ),
  machinesSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      return state.machines.filter((it) => {
        const haystacks = [it.Name, it.VMType].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  })
});

const typedHooks = createTypedHooks<MachinesModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;

const Factory = { create: (accessor: AppModelAccessor) => createModel(accessor) };

export default Factory;
