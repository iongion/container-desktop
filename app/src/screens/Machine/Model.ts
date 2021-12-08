// vendors
import { Action, Thunk, Computed, action, thunk, computed } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { Machine } from "../../Types";
import { Native } from "../../Native";
import { FetchMachineOptions, CreateMachineOptions } from "../../Api.clients";

export interface MachinesModelState {
  native: boolean;
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

export const createModel = (registry: AppRegistry): MachinesModel => {
  const native = Native.getInstance().isNative();
  return {
    native,
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
      registry.withPending(async () => {
        const machines = await registry.api.getMachines();
        actions.setMachines(machines);
        return machines;
      })
    ),
    machineStop: thunk(async (actions, options) =>
      registry.withPending(async () => {
        let stopped = false;
        if (options.Name) {
          const result = await registry.api.stopMachine(options.Name);
          console.debug("Stop result", result);
          stopped = true;
        }
        return stopped;
      })
    ),
    machineRestart: thunk(async (actions, options) =>
      registry.withPending(async () => {
        let restarted = false;
        if (options.Name) {
          const result = await registry.api.restartMachine(options.Name);
          console.debug("Restart result", result);
          restarted = true;
        }
        return restarted;
      })
    ),
    machineConnect: thunk(async (actions, options) =>
      registry.withPending(async () => {
        let connected = false;
        if (options.Name) {
          const result = await registry.api.connectToMachine(options.Name);
          console.debug("Connect result", result);
          connected = true;
        }
        return connected;
      })
    ),
    machineFetch: thunk(async (actions, options) =>
      registry.withPending(async () => {
        const machine = await registry.api.getMachine(options.Name);
        return machine;
      })
    ),
    machineCreate: thunk(async (actions, options) =>
      registry.withPending(async () => {
        const created = await registry.api.createMachine(options);
        return created;
      })
    ),
    machineRemove: thunk(async (actions, options) =>
      registry.withPending(async () => {
        let removed = false;
        if (options.Name) {
          removed = await registry.api.removeMachine(options.Name);
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
  };
};

const Factory = { create: (registry: AppRegistry) => createModel(registry) };

export default Factory;
