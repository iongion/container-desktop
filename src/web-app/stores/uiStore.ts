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
  // Console height as a percentage of the viewport for the quake (top/bottom) variants — driven by dragging
  // the header resize handle. Clamped to CONSOLE_HEIGHT_MIN..MAX. Ignored by the right/center variants.
  height: number;
}

// Drag-resize bounds for the quake console height (percent of viewport). The panel may never grow past 80%
// (keep the app usable behind it) nor shrink below 10% (stay grabbable/legible), and never below a hard
// CONSOLE_MIN_PX pixel floor so it stays usable on short screens where 10% would be tiny.
export const CONSOLE_HEIGHT_MIN = 10;
export const CONSOLE_HEIGHT_MAX = 80;
export const CONSOLE_MIN_PX = 250;

// Effective height clamp evaluated against the live viewport: the lower bound is whichever is taller of the
// 10% floor and the 250px floor, so 250px binds on ordinary screens while 10% still binds on very tall ones.
export function clampConsoleHeight(pct: number, viewportPx: number): number {
  const minFromPx = viewportPx > 0 ? (CONSOLE_MIN_PX / viewportPx) * 100 : CONSOLE_HEIGHT_MIN;
  const min = Math.max(CONSOLE_HEIGHT_MIN, minFromPx);
  return Math.min(CONSOLE_HEIGHT_MAX, Math.max(min, pct));
}

// The active screen's identity, pushed from App's AppLayout so non-routing consumers — the AI console
// header chip and the assistant's context collector — can read "what screen is the user on" without the router.
export interface CurrentScreenMeta {
  id?: string;
  title?: string;
}

const DEFAULT_ASSISTANT_CONSOLE: AssistantConsoleUI = { open: false, variant: "bottom", opacity: 0.9, height: 56 };

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
  setAssistantConsoleHeight: (height: number) => void;
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
  setAssistantConsoleHeight: (height) =>
    // Clamp the drag-resize to CONSOLE_HEIGHT_MIN..MAX so the quake console can never swallow the app nor collapse.
    set((state) => ({
      assistantConsole: {
        ...state.assistantConsole,
        height: Math.min(CONSOLE_HEIGHT_MAX, Math.max(CONSOLE_HEIGHT_MIN, height)),
      },
    })),
  setCurrentScreen: (meta) => set({ currentScreen: meta }),
  // Reset on connection switch clears per-connection view state only; the console + current-screen persist.
  reset: () => set({ search: {}, collapsedGroups: {}, selectedRows: {}, overlays: {} }),
}));
