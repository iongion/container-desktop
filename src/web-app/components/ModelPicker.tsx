// One minimal footer-style button → a drill-down popover: AI inference source → provider →
// model. The popover content is the SHARED <ModelNavigator> (the same drill-down the Settings screen
// embeds). This wrapper owns only the popover concerns: the trigger button + label, open/close, the
// discovery cache (held here so it survives open/close), persistence (sticky defaultProvider + the model
// per provider), and closing on pick. Props are {value, onChange}; the trigger label is the selected
// path joined by " / " ("LM Studio / qwen3.5-9b").
import { Button, PopoverNext } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DEFAULT_AI_SETTINGS, getProviderEntry } from "@/ai-system/core";
import { buildModelTree, selectedPath } from "@/ai-system/ui/core/modelCatalog";
import type { AISettings } from "@/env/Types";
import { useAppStore } from "@/web-app/stores/appStore";

import { ModelNavigator, type ModelNavigatorHandle, type ModelPickerValue } from "./ai/ModelNavigator";
import { persistModelSelection } from "./ai/persistSelection";
import { useModelDiscovery } from "./ai/useModelDiscovery";
import { providerIcon } from "./providerIcon";
import "./ai/ModelNavigator.css";
import "./ModelPicker.css";

export type { ModelPickerValue };

export interface ModelPickerProps {
  value: ModelPickerValue;
  onChange: (value: ModelPickerValue) => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const ai: AISettings = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  const discovery = useModelDiscovery();
  const { discover, modelsBySource } = discovery;
  const [open, setOpen] = useState(false);
  const navRef = useRef<ModelNavigatorHandle>(null);

  // Persist the chosen source (sticky default) + its per-provider model, then report it up to the composer.
  const persist = useCallback(
    (next: ModelPickerValue) => {
      persistModelSelection(next);
      onChange(next);
    },
    [onChange],
  );

  // A user pick closes the popover; auto-select (below) persists without closing.
  const handlePick = useCallback(
    (next: ModelPickerValue) => {
      persist(next);
      setOpen(false);
    },
    [persist],
  );

  // Pre-fetch the active source on mount (and when it changes) so the composer has a model to submit even
  // if the user never opens the popover.
  useEffect(() => {
    void discover(value.providerId);
  }, [discover, value.providerId]);

  // Smart default: when the active source is reachable and nothing is saved (or llama.cpp's served model
  // drifted), apply its first/served model. Converges — once saved, autoSelect clears.
  useEffect(() => {
    const sourceId = value.providerId;
    const entry = getProviderEntry(sourceId);
    const models = modelsBySource[sourceId];
    if (!entry || !models) {
      return;
    }
    const tree = buildModelTree({ entry, models, savedModel: ai.providers?.[sourceId]?.model ?? "" });
    if (tree.autoSelect && tree.autoSelect !== value.model) {
      persist({ providerId: sourceId, model: tree.autoSelect });
    }
  }, [modelsBySource, value.providerId, value.model, ai.providers, persist]);

  const triggerLabel = useMemo(() => {
    const path = selectedPath(value.providerId, value.model);
    return path.length > 0 ? path.join(" / ") : t("Select a model");
  }, [value.providerId, value.model, t]);

  return (
    <PopoverNext
      className="ModelPickerPopoverTarget"
      popoverClassName="ModelPickerPopover"
      isOpen={open}
      onInteraction={(next) => {
        setOpen(next);
        if (!next) {
          navRef.current?.resetNav();
        }
      }}
      placement="bottom-start"
      usePortal
      hasBackdrop={false}
      content={
        <div className="ModelPicker">
          <ModelNavigator
            ref={navRef}
            value={value}
            onPick={handlePick}
            discovery={discovery}
            showNotConfigured
            maxHeight={360}
          />
        </div>
      }
    >
      <Button
        className="ModelPickerTrigger"
        variant="minimal"
        size="small"
        icon={providerIcon(value.providerId)}
        endIcon={IconNames.CARET_UP}
        title={t("Inference source and model")}
        aria-label={t("Inference source and model")}
      >
        <span className="ModelPickerTriggerLabel">{triggerLabel}</span>
      </Button>
    </PopoverNext>
  );
};
