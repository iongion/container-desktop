// vendors
import { Action, Thunk, Computed, action, thunk, computed } from "easy-peasy";
// project
import { AppRegistry, ResetableModel } from "../../domain/types";
import { FetchVolumeOptions, CreateVolumeOptions } from "../../Api.clients";
import { Volume } from "../../Types.container-app";

export interface VolumesModelState {
  volumes: Volume[];
}

export interface VolumesModel extends VolumesModelState, ResetableModel<VolumesModel>{
  volumes: Volume[];
  // actions
  setVolumes: Action<VolumesModel, Volume[]>;
  volumeUpdate: Action<VolumesModel, Partial<Volume>>;
  volumeDelete: Action<VolumesModel, Partial<Volume>>;
  volumesSearchByTerm: Computed<VolumesModel, (searchTerm: string) => Volume[]>;
  // thunks
  volumesFetch: Thunk<VolumesModel>;
  volumeFetch: Thunk<VolumesModel, FetchVolumeOptions>;
  volumeCreate: Thunk<VolumesModel, CreateVolumeOptions>;
  volumeRemove: Thunk<VolumesModel, Partial<Volume>>;
}

export const createModel = (registry: AppRegistry): VolumesModel => ({
  volumes: [],
  // actions
  reset: action((state) => {
    state.volumes = [];
  }),
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
  // computed
  volumesSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      if (!searchTerm) {
        return state.volumes;
      }
      return state.volumes.filter((it) => {
        const haystacks = [it.Name, it.Scope].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  }),
  // thunks
  volumesFetch: thunk(async (actions) =>
    registry.withPending(async () => {
      const volumes = await registry.api.getVolumes();
      actions.setVolumes(volumes);
      return volumes;
    })
  ),
  volumeFetch: thunk(async (actions, opts) =>
    registry.withPending(async () => {
      const volume = await registry.api.getVolume(opts.Id);
      return volume;
    })
  ),
  volumeCreate: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const created = await registry.api.createVolume(options);
      return created;
    })
  ),
  volumeRemove: thunk(async (actions, volume) =>
    registry.withPending(async () => {
      let removed = false;
      if (volume.Name) {
        removed = await registry.api.removeVolume(volume.Name);
      }
      return removed;
    })
  )
});
