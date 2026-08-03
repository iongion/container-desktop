// The worker editor's inference-source picker: the SAME trigger + drill-down popover the assistant composer
// uses (ModelNavigator), so choosing a model feels identical wherever you do it.
//
// This is deliberately NOT <ModelPicker>. That wrapper calls persistModelSelection on every pick, which rewrites
// the app-wide default provider and its per-provider model — correct for the composer, wrong here: a worker's
// model is a property of that worker, and editing one must not silently repoint the assistant. So this owns the
// popover concerns (open/close, discovery cache, trigger label) and reports the pick upward, persisting nothing.

import { Button, PopoverNext } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatSelectedPath, selectedPath } from "@/ai-system/ui/core/modelCatalog";
import {
  ModelNavigator,
  type ModelNavigatorHandle,
  type ModelPickerValue,
} from "@/web-app/components/ai/ModelNavigator";
import { useModelDiscovery } from "@/web-app/components/ai/useModelDiscovery";
import { providerIcon } from "@/web-app/components/providerIcon";

import "@/web-app/components/ai/ModelNavigator.css";
import "@/web-app/components/ModelPicker.css";

export interface WorkerModelPickerProps {
  value: ModelPickerValue;
  onChange: (value: ModelPickerValue) => void;
  disabled?: boolean;
}

export const WorkerModelPicker: React.FC<WorkerModelPickerProps> = ({ value, onChange, disabled }) => {
  const { t } = useTranslation();
  const discovery = useModelDiscovery();
  const { discover } = discovery;
  const [open, setOpen] = useState(false);
  const navRef = useRef<ModelNavigatorHandle>(null);

  const handlePick = useCallback(
    (next: ModelPickerValue) => {
      onChange(next);
      setOpen(false);
    },
    [onChange],
  );

  // Warm the selected source so its models are listed the moment the popover opens.
  useEffect(() => {
    if (value.providerId) {
      void discover(value.providerId);
    }
  }, [discover, value.providerId]);

  const path = selectedPath(value.providerId, value.model);
  const label = path.length > 0 ? formatSelectedPath(path, !!value.model, (part) => t(part)) : t("Select a model");

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
      disabled={disabled}
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
        endIcon={IconNames.CARET_DOWN}
        title={t("Inference source and model")}
        aria-label={t("Inference source and model")}
        disabled={disabled}
      >
        <span className="ModelPickerTriggerLabel">{label}</span>
      </Button>
    </PopoverNext>
  );
};
