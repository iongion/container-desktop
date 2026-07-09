// web-app/stores/uiStore.ts — client-only UI state (per-screen search term, collapsed groups, selected
// rows, overlays, the summonable AI console, and the active screen's identity). Keyed by an arbitrary scope
// string (usually the screen id) so each screen keeps its own slice. Reset on connection switch.

import { create } from "zustand";

export type AssistantConsoleVariant = "top" | "bottom" | "right" | "center";

export interface AssistantConsoleUI {
  open: boolean;
  variant: AssistantConsoleVariant;
  // Console opacity for the quake (top/bottom) variants — driven by the header transparency slider so the
  // screen shows through. Ignored by the right/center variants.
  opacity: number;
}

// The active screen's identity, pushed from App's AppLayout so non-routing consumers — the AI console
// header chip and the assistant's context collector — can read "what screen is the user on" without the router.
export interface CurrentScreenMeta {
  id?: string;
  title?: string;
}

const DEFAULT_ASSISTANT_CONSOLE: AssistantConsoleUI = { open: false, variant: "bottom", opacity: 0.9 };

interface UIState {
  search: Record<string, string>;
  collapsedGroups: Record<string, boolean>;
  selectedRows: Record<string, string[]>;
  overlays: Record<string, boolean>;
  assistantConsole: AssistantConsoleUI;
  currentScreen: CurrentScreenMeta;
  setSearch: (scope: string, term: string) => void;
  toggleGroup: (key: string) => void;
  setGroupCollapsed: (key: string, collapsed: boolean) => void;
  setSelectedRows: (scope: string, ids: string[]) => void;
  setOverlay: (key: string, open: boolean) => void;
  toggleAssistantConsole: () => void;
  setAssistantConsoleOpen: (open: boolean) => void;
  setAssistantConsoleVariant: (variant: AssistantConsoleVariant) => void;
  setAssistantConsoleOpacity: (opacity: number) => void;
  setCurrentScreen: (meta: CurrentScreenMeta) => void;
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  search: {},
  collapsedGroups: {},
  selectedRows: {},
  overlays: {},
  assistantConsole: DEFAULT_ASSISTANT_CONSOLE,
  currentScreen: {},
  setSearch: (scope, term) => set((state) => ({ search: { ...state.search, [scope]: term } })),
  toggleGroup: (key) =>
    set((state) => ({ collapsedGroups: { ...state.collapsedGroups, [key]: !state.collapsedGroups[key] } })),
  setGroupCollapsed: (key, collapsed) =>
    set((state) => ({ collapsedGroups: { ...state.collapsedGroups, [key]: collapsed } })),
  setSelectedRows: (scope, ids) => set((state) => ({ selectedRows: { ...state.selectedRows, [scope]: ids } })),
  setOverlay: (key, open) => set((state) => ({ overlays: { ...state.overlays, [key]: open } })),
  toggleAssistantConsole: () =>
    set((state) => ({ assistantConsole: { ...state.assistantConsole, open: !state.assistantConsole.open } })),
  setAssistantConsoleOpen: (open) => set((state) => ({ assistantConsole: { ...state.assistantConsole, open } })),
  setAssistantConsoleVariant: (variant) =>
    set((state) => ({ assistantConsole: { ...state.assistantConsole, variant } })),
  setAssistantConsoleOpacity: (opacity) =>
    // Clamp to the slider's 60–100% range so the console can never render nearly invisible.
    set((state) => ({ assistantConsole: { ...state.assistantConsole, opacity: Math.min(1, Math.max(0.6, opacity)) } })),
  setCurrentScreen: (meta) => set({ currentScreen: meta }),
  // Reset on connection switch clears per-connection view state only; the console + current-screen persist.
  reset: () => set({ search: {}, collapsedGroups: {}, selectedRows: {}, overlays: {} }),
}));
