// Persist a chosen model selection. Shared by the chat popover (ModelPicker) and the
// embedded Settings selector (ProviderSelector) so both write IDENTICALLY: the source becomes the sticky
// default provider and the model is stored per-provider. Reads the store action directly (Zustand vanilla
// access) so it can be called from event handlers/effects without prop-threading.

import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import { useAppStore } from "@/web-app/stores/appStore";

import type { ModelPickerValue } from "./ModelNavigator";

export function persistModelSelection(next: ModelPickerValue): void {
  const current = useAppStore.getState().userSettings.ai ?? DEFAULT_AI_SETTINGS;
  const provider = current.providers?.[next.providerId];
  void useAppStore.getState().setGlobalUserSettings({
    ai: {
      ...current,
      defaultProvider: next.providerId,
      providers: { ...current.providers, [next.providerId]: { ...provider, model: next.model } },
    },
  });
}
