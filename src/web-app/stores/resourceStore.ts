import { create } from "zustand";

import type { Container, ContainerImage, Network, Pod, Secret, Volume } from "@/env/Types";

export type ResourceDomain = "containers" | "images" | "pods" | "volumes" | "networks" | "secrets";

export const RESOURCE_DOMAINS: ResourceDomain[] = ["containers", "images", "pods", "volumes", "networks", "secrets"];

export interface ResourceItemsByDomain {
  containers: Container;
  images: ContainerImage;
  pods: Pod;
  volumes: Volume;
  networks: Network;
  secrets: Secret;
}

export interface ResourceSlice<T = unknown> {
  items: T[];
  loading: boolean;
  lastUpdated?: number;
  lastError?: string;
  eventsConnected: boolean;
  fallbackPolling: boolean;
}

export type ResourceConnectionSnapshot = {
  [K in ResourceDomain]: ResourceSlice<ResourceItemsByDomain[K]>;
};

interface ResourceStoreState {
  byConnection: Record<string, ResourceConnectionSnapshot>;
}

interface ResourceStoreActions {
  ensureConnection: (connectionId: string) => void;
  setSnapshot: <D extends ResourceDomain>(
    connectionId: string,
    domain: D,
    items: ResourceItemsByDomain[D][],
  ) => void;
  setStatus: <D extends ResourceDomain>(
    connectionId: string,
    domain: D,
    status: Partial<Omit<ResourceSlice<ResourceItemsByDomain[D]>, "items">>,
  ) => void;
  resetConnection: (connectionId: string) => void;
  resetAll: () => void;
}

export type ResourceStore = ResourceStoreState & ResourceStoreActions;

export function createResourceSlice<T>(): ResourceSlice<T> {
  return {
    items: [],
    loading: false,
    eventsConnected: false,
    fallbackPolling: false,
  };
}

export function createConnectionSnapshot(): ResourceConnectionSnapshot {
  return {
    containers: createResourceSlice<Container>(),
    images: createResourceSlice<ContainerImage>(),
    pods: createResourceSlice<Pod>(),
    volumes: createResourceSlice<Volume>(),
    networks: createResourceSlice<Network>(),
    secrets: createResourceSlice<Secret>(),
  };
}

export const useResourceStore = create<ResourceStore>()(
  (set) => ({
    byConnection: {},

    ensureConnection: (connectionId) =>
      set((state) =>
        state.byConnection[connectionId]
          ? {}
          : { byConnection: { ...state.byConnection, [connectionId]: createConnectionSnapshot() } },
      ),

    setSnapshot: (connectionId, domain, items) =>
      set((state) => {
        const snapshot = state.byConnection[connectionId] ?? createConnectionSnapshot();
        const slice = snapshot[domain] as ResourceSlice;
        return {
          byConnection: {
            ...state.byConnection,
            [connectionId]: {
              ...snapshot,
              [domain]: {
                ...slice,
                items,
                loading: false,
                lastUpdated: Date.now(),
                lastError: undefined,
              },
            },
          },
        };
      }),

    setStatus: (connectionId, domain, status) =>
      set((state) => {
        const snapshot = state.byConnection[connectionId] ?? createConnectionSnapshot();
        return {
          byConnection: {
            ...state.byConnection,
            [connectionId]: {
              ...snapshot,
              [domain]: {
                ...snapshot[domain],
                ...status,
              },
            },
          },
        };
      }),

    resetConnection: (connectionId) =>
      set((state) => {
        const { [connectionId]: _removed, ...byConnection } = state.byConnection;
        return { byConnection };
      }),

    resetAll: () => set({ byConnection: {} }),
  }),
);

export function getResourceSlice<D extends ResourceDomain>(
  connectionId: string | undefined,
  domain: D,
): ResourceSlice<ResourceItemsByDomain[D]> {
  if (!connectionId) {
    return createResourceSlice<ResourceItemsByDomain[D]>();
  }
  return useResourceStore.getState().byConnection[connectionId]?.[domain] ?? createResourceSlice<ResourceItemsByDomain[D]>();
}
