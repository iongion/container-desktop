// Ephemeral one-shot handoff of AI-generated compose text from the Generator screen to the Stacks
// "Add stack" drawer — closes the generate → deploy loop without a save-to-disk detour. Not persisted.

import { create } from "zustand";

interface StackHandoffState {
  // Raw compose YAML text queued for the Stacks Add-Stack drawer, or null when nothing is pending.
  pendingComposeText: string | null;
  setPendingComposeText: (text: string | null) => void;
}

export const useStackHandoffStore = create<StackHandoffState>((set) => ({
  pendingComposeText: null,
  setPendingComposeText: (text) => set({ pendingComposeText: text }),
}));
