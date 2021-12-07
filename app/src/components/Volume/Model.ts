// vendors
import { Action, Thunk, Computed, action, thunk, computed, createTypedHooks } from "easy-peasy";
// project
import { AppModelAccessor } from "../../domain/types";
import { api, withPending } from "../../domain/client";
import { Volume } from "../../Types";
import { FetchVolumeOptions, CreateVolumeOptions } from "../../Api.clients";

export interface VolumesModelState {
  volumes: Volume[];
}

export interface VolumesModel extends VolumesModelState {
  volumes: Volume[];
  // actions
  setVolumes: Action<VolumesModel, Volume[]>;
  volumeUpdate: Action<VolumesModel, Partial<Volume>>;
  volumeDelete: Action<VolumesModel, Partial<Volume>>;
  // thunks
  volumesFetch: Thunk<VolumesModel>;
  volumeFetch: Thunk<VolumesModel, FetchVolumeOptions>;
  volumeCreate: Thunk<VolumesModel, CreateVolumeOptions>;
  volumeRemove: Thunk<VolumesModel, Partial<Volume>>;
  volumesSearchByTerm: Computed<VolumesModel, (searchTerm: string) => Volume[]>;
}

export const createModel = (accessor: AppModelAccessor): VolumesModel => ({
  volumes: [],
  // actions
  setVolumes: action((state, volumes) => {
    state.volumes = volumes;
  }),
  volumeUpdate: action((state, volume) => {
    const existing = state.volumes.find((it) => it.Name === volume.Name);
    if (existing) {
      // Transfer all keys
      Object.entries(volume).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
    }
  }),
  volumeDelete: action((state, volume) => {
    const existingPos = state.volumes.findIndex((it) => it.Name === volume.Name);
    if (existingPos !== -1) {
      state.volumes.splice(existingPos, 1);
    }
  }),
  // thunks
  volumesFetch: thunk(async (actions) =>
    withPending(actions, async () => {
      const volumes = await api.getVolumes();
      actions.setVolumes(volumes);
      return volumes;
    })
  ),
  volumeFetch: thunk(async (actions, opts) =>
    withPending(actions, async () => {
      const volume = await api.getVolume(opts.Id);
      return volume;
    })
  ),
  volumeCreate: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const created = await api.createVolume(options);
      return created;
    })
  ),
  volumeRemove: thunk(async (actions, volume) =>
    withPending(actions, async () => {
      let removed = false;
      if (volume.Name) {
        removed = await api.removeVolume(volume.Name);
      }
      return removed;
    })
  ),
  // computed
  volumesSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      return state.volumes.filter((it) => {
        const haystacks = [it.Name, it.Scope].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  })
});

const typedHooks = createTypedHooks<VolumesModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;

const Factory = { create: (accessor: AppModelAccessor) => createModel(accessor) };

export default Factory;
