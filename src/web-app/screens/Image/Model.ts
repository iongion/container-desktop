import { Action, Computed, Thunk, action, computed, thunk } from "easy-peasy";

import { FetchImageOptions } from "@/container-client/Api.clients";
import { Application } from "@/container-client/Application";
import { ContainerImage } from "@/env/Types";
import { AppRegistry, ResetableModel } from "@/web-app/domain/types";

export interface ImagesModelState {
  native: boolean;
  images: ContainerImage[];
}

export interface ImagesModel extends ImagesModelState, ResetableModel<ImagesModel> {
  // actions
  setImages: Action<ImagesModel, ContainerImage[]>;
  update: Action<ImagesModel, Partial<ContainerImage>>;
  delete: Action<ImagesModel, Partial<ContainerImage>>;
  searchByTerm: Computed<ImagesModel, (searchTerm: string) => ContainerImage[]>;
  // thunks
  fetchAll: Thunk<ImagesModel>;
  imageFetch: Thunk<ImagesModel, FetchImageOptions>;
  fetchHistory: Thunk<ImagesModel, FetchImageOptions>;
  imagePull: Thunk<ImagesModel, Partial<ContainerImage>>;
  imagePush: Thunk<ImagesModel, Partial<ContainerImage>>;
  imageRemove: Thunk<ImagesModel, Partial<ContainerImage>>;

  containerCreate: Thunk<ImagesModel, any>;
}

export const createModel = async (registry: AppRegistry): Promise<ImagesModel> => {
  const instance = Application.getInstance();
  const native = await instance.isNative();
  return {
    native,
    images: [],
    // actions
    reset: action((state) => {
      state.images = [];
    }),
    setImages: action((state, images) => {
      state.images = images;
    }),
    update: action((state, image) => {
      const existing = state.images.find((it) => it.Id === image.Id);
      if (existing) {
        // Transfer all keys
        Object.entries(image).forEach(([k, v]) => {
          (existing as any)[k] = v;
        });
      }
    }),
    delete: action((state, image) => {
      const existingPos = state.images.findIndex((it) => it.Id === image.Id);
      if (existingPos !== -1) {
        state.images.splice(existingPos, 1);
      }
      console.warn("TODO - must delete all associated containers");
    }),
    searchByTerm: computed((state) => {
      return (searchTerm: string) => {
        if (!searchTerm) {
          return state.images;
        }
        return state.images.filter((it) => {
          const haystacks = [it.Name, it.Id].map((t) => t.toLowerCase());
          const matching = haystacks.find((it) => it.includes(searchTerm));
          return !!matching;
        });
      };
    }),
    // thunks
    fetchAll: thunk(async (actions) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        const images = await client.getImages();
        actions.setImages(images);
        return images;
      })
    ),
    imageFetch: thunk(async (actions, options) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        const image = await client.getImage(options.Id, options);
        if (image) {
          actions.update(image);
        }
        return image;
      })
    ),
    fetchHistory: thunk(async (actions, options) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        const history = await client.getImageHistory(options.Id);
        actions.update({ Id: options.Id, History: history });
        return history;
      })
    ),
    imagePull: thunk(async (actions, image) =>
      registry.withPending(async () => {
        let pulled = false;
        if (image.Names) {
          const client = await registry.getContainerClient();
          pulled = await client.pullImage(image.Names[0]);
        }
        if (pulled) {
          actions.update(image);
        }
        return pulled;
      })
    ),
    imagePush: thunk(async (actions, image) =>
      registry.withPending(async () => {
        let pushed = false;
        if (image.Id) {
          const client = await registry.getContainerClient();
          pushed = await client.pushImage(image.Id);
        }
        return pushed;
      })
    ),
    imageRemove: thunk(async (actions, image) =>
      registry.withPending(async () => {
        let removed = false;
        if (image.Id) {
          const client = await registry.getContainerClient();
          removed = await client.removeImage(image.Id);
        }
        if (removed) {
          actions.delete(image);
        }
        return removed;
      })
    ),
    containerCreate: thunk(async (actions, image) =>
      registry.withPending(async () => {
        let removed = false;
        if (image.Id) {
          const client = await registry.getContainerClient();
          removed = await client.removeImage(image.Id);
        }
        if (removed) {
          actions.delete(image);
        }
        return removed;
      })
    )
  };
};
