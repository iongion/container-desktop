// vendors
import { Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry, ResetableModel } from "../../domain/types";

export interface TroubleshootModelState {}

export interface TroubleshootModel extends TroubleshootModelState, ResetableModel<TroubleshootModel> {
  // actions
  // thunks
  troubleShootPrune: Thunk<TroubleshootModel>;
  troubleShootReset: Thunk<TroubleshootModel>;
}

export const createModel = (registry: AppRegistry): TroubleshootModel => {
  return {
    reset: action((state) => {}),
    troubleShootPrune: thunk(async (actions) =>
      registry.withPending(async () => {
        await registry.api.pruneSystem();
      })
    ),
    troubleShootReset: thunk(async (actions) =>
      registry.withPending(async (store) => {
        await registry.api.resetSystem();
      })
    )
  };
};
