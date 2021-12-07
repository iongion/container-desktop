// vendors
import { Thunk, thunk, createTypedHooks, Store, EasyPeasyConfig } from "easy-peasy";
// project
import { AppModel } from "../../domain/types";
import { api, withPending } from "../../domain/client";

export interface TroubleshootModelState {}

export interface TroubleshootModel extends TroubleshootModelState {
  // actions
  // thunks
  troubleShootPrune: Thunk<TroubleshootModel>;
  troubleShootReset: Thunk<TroubleshootModel>;
}

export const createModel = (store: Store<AppModel, EasyPeasyConfig<undefined, {}>>): TroubleshootModel => ({
  troubleShootPrune: thunk(async (actions) =>
    withPending(actions, async () => {
      const report = await api.pruneSystem();
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
    withPending(actions, async () => {
      const report = await api.resetSystem();
      if (report) {
        console.debug("Report is here", report);
        const domain = await api.getDomain();
        // store.getActions().domainUpdate({ ...domain });
      }
      return report;
    })
  )
});

const typedHooks = createTypedHooks<TroubleshootModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;

const Factory = { create: (store: Store<AppModel, EasyPeasyConfig<undefined, {}>>) => createModel(store) };

export default Factory;
