// vendors
import { Thunk, thunk } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";

export interface TroubleshootModelState {}

export interface TroubleshootModel extends TroubleshootModelState {
  // actions
  // thunks
  troubleShootPrune: Thunk<TroubleshootModel>;
  troubleShootReset: Thunk<TroubleshootModel>;
}

export const createModel = (registry: AppRegistry): TroubleshootModel => {
  return {
    troubleShootPrune: thunk(async (actions) =>
      registry.withPending(async () => {
        const report = await registry.api.pruneSystem();
        if (report) {
          try {
            // await store.getActions().domainFetch();
          } catch (error) {
            console.error("Unable to reload domain", error);
          }
        }
        return report;
      })
    ),
    troubleShootReset: thunk(async (actions) =>
      registry.withPending(async (store) => {
        const report = await registry.api.resetSystem();
        if (report) {
          console.debug("Report is here", report);
          store.getActions().domainUpdate({ connections: [] });
        }
        return report;
      })
    )
  };
};

const Factory = { create: (registry: AppRegistry) => createModel(registry) };

export default Factory;
