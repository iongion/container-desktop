import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SortDirection = "asc" | "desc";

export interface SortSpec {
  field: string;
  dir: SortDirection;
}

interface SortStore {
  sorts: Record<string, SortSpec | undefined>;
  setSort: (scope: string, field: string) => void;
  clearSort: (scope: string) => void;
}

export function nextSortSpec(current: SortSpec | undefined, field: string): SortSpec | undefined {
  if (!current || current.field !== field) {
    return { field, dir: "asc" };
  }
  if (current.dir === "asc") {
    return { field, dir: "desc" };
  }
  return undefined;
}

export const useSortStore = create<SortStore>()(
  persist(
    (set) => ({
      sorts: {},
      setSort: (scope, field) =>
        set((state) => ({
          sorts: {
            ...state.sorts,
            [scope]: nextSortSpec(state.sorts[scope], field),
          },
        })),
      clearSort: (scope) =>
        set((state) => {
          const { [scope]: _removed, ...sorts } = state.sorts;
          return { sorts };
        }),
    }),
    {
      name: "container-desktop.sorts",
      partialize: (state) => ({ sorts: state.sorts }),
    },
  ),
);
