// web-app/stores/uiStore.ts — client-only UI state (per-screen search term, collapsed groups, selected
// rows, overlays). Keyed by an arbitrary scope string (usually the screen id) so each screen keeps its
// own slice. Reset on connection switch.

import { create } from "zustand";

interface UIState {
  search: Record<string, string>;
  collapsedGroups: Record<string, boolean>;
  selectedRows: Record<string, string[]>;
  overlays: Record<string, boolean>;
  setSearch: (scope: string, term: string) => void;
  toggleGroup: (key: string) => void;
  setGroupCollapsed: (key: string, collapsed: boolean) => void;
  setSelectedRows: (scope: string, ids: string[]) => void;
  setOverlay: (key: string, open: boolean) => void;
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  search: {},
  collapsedGroups: {},
  selectedRows: {},
  overlays: {},
  setSearch: (scope, term) => set((state) => ({ search: { ...state.search, [scope]: term } })),
  toggleGroup: (key) =>
    set((state) => ({ collapsedGroups: { ...state.collapsedGroups, [key]: !state.collapsedGroups[key] } })),
  setGroupCollapsed: (key, collapsed) =>
    set((state) => ({ collapsedGroups: { ...state.collapsedGroups, [key]: collapsed } })),
  setSelectedRows: (scope, ids) => set((state) => ({ selectedRows: { ...state.selectedRows, [scope]: ids } })),
  setOverlay: (key, open) => set((state) => ({ overlays: { ...state.overlays, [key]: open } })),
  reset: () => set({ search: {}, collapsedGroups: {}, selectedRows: {}, overlays: {} }),
}));
