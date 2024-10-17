import { type Action, type Computed, type Thunk, action, computed, thunk } from "easy-peasy";

import type { CreateVolumeOptions, FetchVolumeOptions } from "@/container-client/Api.clients";
import type { Volume } from "@/env/Types";
import type { AppRegistry, ResetableModel } from "@/web-app/domain/types";
import { sortAlphaNum } from "@/web-app/domain/utils";

export interface VolumesModelState {
  version?: string;
  volumes: Volume[];
}

export interface VolumesModel extends VolumesModelState, ResetableModel<VolumesModel> {
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

export const createModel = async (registry: AppRegistry): Promise<VolumesModel> => ({
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
        return state.volumes.sort((a, b) => sortAlphaNum(a.Name, b.Name));
      }
      return state.volumes
        .sort((a, b) => sortAlphaNum(a.Name, b.Name))
        .filter((it) => {
          const haystacks = [it.Name, it.Scope].map((t) => t.toLowerCase());
          const matching = haystacks.find((it) => it.includes(searchTerm));
          return !!matching;
        });
    };
  }),
  // thunks
  volumesFetch: thunk(async (actions) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const volumes = await client.getVolumes();
      actions.setVolumes(volumes);
      return volumes;
    }),
  ),
  volumeFetch: thunk(async (actions, opts) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const volume = await client.getVolume(opts.Id);
      return volume;
    }),
  ),
  volumeCreate: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const created = await client.createVolume(options);
      return created;
    }),
  ),
  volumeRemove: thunk(async (actions, volume) =>
    registry.withPending(async () => {
      let removed = false;
      if (volume.Name) {
        const client = await registry.getContainerClient();
        removed = await client.removeVolume(volume.Name);
      }
      return removed;
    }),
  ),
});
