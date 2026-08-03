// Client-side interaction layer for the Registries & Trust screen. It is an OPTIMISTIC overlay: registry
// login / logout / add / remove update it immediately so the UI reflects the change even in mock mode (where
// getRegistriesMap short-circuits to fixtures), while the real engine calls run alongside (trustMutations) and
// their query invalidation reconciles the true state on a real engine. Per-connection Certificates + Proxy now
// live in the connection edit form, so this store only tracks registry state + which header CTA drawer is open.

import { create } from "zustand";

import type { RegistryAuthInfo, RegistryTlsState } from "@/container-client/types/registry";

export interface AddedRegistry {
  name: string;
  tls: RegistryTlsState;
  mirrorOf?: string;
}

// Which header-CTA drawer is open (shared between the screen header and the mounted panel).
export type TrustDialog = "add-registry";

interface TrustState {
  // Per-registry auth override (login / explicit logout), keyed by scopeKey(connId, name).
  authOverrides: Record<string, RegistryAuthInfo>;
  // Registries added this session, per connection id.
  added: Record<string, AddedRegistry[]>;
  removed: Record<string, true>;
  // Open header-CTA drawer, or null.
  dialog: TrustDialog | null;

  login: (connectionId: string, name: string, auth: RegistryAuthInfo) => void;
  logout: (connectionId: string, name: string) => void;
  addRegistry: (connectionId: string, registry: AddedRegistry) => void;
  removeRegistry: (connectionId: string, name: string) => void;
  openDialog: (dialog: TrustDialog) => void;
  closeDialog: () => void;
}

export const scopeKey = (connectionId: string, name: string): string => `${connectionId} ${name}`;

export const useTrustStore = create<TrustState>((set) => ({
  authOverrides: {},
  added: {},
  removed: {},
  dialog: null,

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  login: (connectionId, name, auth) =>
    set((state) => ({ authOverrides: { ...state.authOverrides, [scopeKey(connectionId, name)]: auth } })),

  // Logout is an explicit "anonymous" override so it wins over the fetched auth.
  logout: (connectionId, name) =>
    set((state) => ({
      authOverrides: { ...state.authOverrides, [scopeKey(connectionId, name)]: { kind: "anonymous" } },
    })),

  addRegistry: (connectionId, registry) =>
    set((state) => {
      const existing = state.added[connectionId] ?? [];
      if (existing.some((r) => r.name === registry.name)) {
        return state;
      }
      const { [scopeKey(connectionId, registry.name)]: _dropped, ...removed } = state.removed;
      return { added: { ...state.added, [connectionId]: [...existing, registry] }, removed };
    }),

  removeRegistry: (connectionId, name) =>
    set((state) => ({
      removed: { ...state.removed, [scopeKey(connectionId, name)]: true },
      added: { ...state.added, [connectionId]: (state.added[connectionId] ?? []).filter((r) => r.name !== name) },
    })),
}));
