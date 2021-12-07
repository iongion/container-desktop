// vendors
import { Action, Thunk, Computed, action, thunk, computed, createTypedHooks } from "easy-peasy";
// project
import { AppModelAccessor } from "../../domain/types";
import { api, withPending } from "../../domain/client";
import { ContainerImage } from "../../Types";
import { FetchImageOptions } from "../../Api.clients";

export interface ImagesModelState {
  images: ContainerImage[];
}

export interface ImagesModel extends ImagesModelState {
  images: ContainerImage[];
  // actions
  setImages: Action<ImagesModel, ContainerImage[]>;
  imageUpdate: Action<ImagesModel, Partial<ContainerImage>>;
  imageDelete: Action<ImagesModel, Partial<ContainerImage>>;
  // thunks
  imagesFetch: Thunk<ImagesModel>;
  imageFetch: Thunk<ImagesModel, FetchImageOptions>;
  imageFetchHistory: Thunk<ImagesModel, FetchImageOptions>;
  imagePull: Thunk<ImagesModel, Partial<ContainerImage>>;
  imagePush: Thunk<ImagesModel, Partial<ContainerImage>>;
  imageRemove: Thunk<ImagesModel, Partial<ContainerImage>>;
  imagesSearchByTerm: Computed<ImagesModel, (searchTerm: string) => ContainerImage[]>;
}

export const createModel = (accessor: AppModelAccessor): ImagesModel => ({
  images: [],
  // actions
  setImages: action((state, images) => {
    state.images = images;
  }),
  imageUpdate: action((state, image) => {
    const existing = state.images.find((it) => it.Id === image.Id);
    if (existing) {
      // Transfer all keys
      Object.entries(image).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
    }
  }),
  imageDelete: action((state, image) => {
    const existingPos = state.images.findIndex((it) => it.Id === image.Id);
    if (existingPos !== -1) {
      state.images.splice(existingPos, 1);
    }
    console.warn("TODO - must delete all associated containers");
  }),
  // thunks
  imagesFetch: thunk(async (actions) =>
    withPending(actions, async () => {
      const images = await api.getImages();
      actions.setImages(images);
      return images;
    })
  ),
  imageFetch: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const image = await api.getImage(options.Id, options);
      actions.imageUpdate(image);
      return image;
    })
  ),
  imageFetchHistory: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const history = await api.getImageHistory(options.Id);
      actions.imageUpdate({ Id: options.Id, History: history });
      return history;
    })
  ),
  imagePull: thunk(async (actions, image) =>
    withPending(actions, async () => {
      let pulled = false;
      if (image.Names) {
        pulled = await api.pullImage(image.Names[0]);
      }
      if (pulled) {
        actions.imageDelete(image);
      }
      return pulled;
    })
  ),
  imagePush: thunk(async (actions, image) =>
    withPending(actions, async () => {
      let pushed = false;
      if (image.Id) {
        pushed = await api.pushImage(image.Id);
      }
      return pushed;
    })
  ),
  imageRemove: thunk(async (actions, image) =>
    withPending(actions, async () => {
      let removed = false;
      if (image.Id) {
        removed = await api.removeImage(image.Id);
      }
      if (removed) {
        actions.imageDelete(image);
      }
      return removed;
    })
  ),
  imagesSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      return state.images.filter((it) => {
        const haystacks = [it.Name, it.Id].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  })
});

const typedHooks = createTypedHooks<ImagesModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;

const Factory = { create: (accessor: AppModelAccessor) => createModel(accessor) };

export default Factory;
